import { after, NextResponse } from "next/server";

import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enqueueLectureStudyGeneration } from "@/lib/jobs";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:study-regenerate:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid lecture id." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Study tools can be regenerated after the note is ready." },
      { status: 409 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { error } = await service
    .from("lecture_study_assets")
    .upsert(
      {
        lecture_id: id,
        status: "queued",
        error_message: null,
        model_metadata: {},
      } as never,
      {
        onConflict: "lecture_id",
      },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureStudyGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
