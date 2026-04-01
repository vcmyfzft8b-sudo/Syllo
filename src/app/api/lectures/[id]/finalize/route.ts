import { after, NextResponse } from "next/server";
import { z } from "zod";

import { STORAGE_BUCKET } from "@/lib/constants";
import { validateStoredAudioFile } from "@/lib/file-validation";
import { enqueueLectureProcessing } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { isCanonicalLectureStoragePath } from "@/lib/storage";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { routeIdParamSchema, storagePathSchema } from "@/lib/validation";

const finalizeSchema = z.object({
  path: storagePathSchema,
});

export const maxDuration = 300;
const FINALIZE_LECTURE_MAX_BYTES = 8 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:finalize:post",
    rules: rateLimitPresets.uploadFinalize,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, finalizeSchema, {
    maxBytes: FINALIZE_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (
    !isCanonicalLectureStoragePath({
      path: parsed.data.path,
      userId: user.id,
      lectureId: id,
    })
  ) {
    return NextResponse.json(
      { error: "Neveljavna pot do shrambe." },
      { status: 400 },
    );
  }

  const validatedAudio = await validateStoredAudioFile({
    path: parsed.data.path,
  });

  if (!validatedAudio.ok) {
    await createSupabaseServiceRoleClient()
      .storage
      .from(STORAGE_BUCKET)
      .remove([parsed.data.path]);

    return NextResponse.json({ error: validatedAudio.error }, { status: 400 });
  }

  const { error } = await supabase
    .from("lectures")
    .update(
      {
        storage_path: parsed.data.path,
        status: "queued",
        error_message: null,
      } as never,
    )
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureProcessing(id);
  });

  return NextResponse.json({ ok: true });
}
