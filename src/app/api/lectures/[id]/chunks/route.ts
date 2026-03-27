import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLectureChunkStoragePath } from "@/lib/storage";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const chunkSchema = z.object({
  index: z.number().int().min(0).max(100),
  mimeType: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
});

const prepareChunkUploadsSchema = z.object({
  chunks: z.array(chunkSchema).min(1).max(32),
});

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
    route: "api:lectures:chunks:post",
    rules: rateLimitPresets.upload,
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

  const body = await request.json().catch(() => null);
  const parsed = prepareChunkUploadsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const manifests = parsed.data.chunks.map((chunk) => ({
    index: chunk.index,
    mimeType: chunk.mimeType,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    path: buildLectureChunkStoragePath({
      userId: user.id,
      lectureId: id,
      index: chunk.index,
      mimeType: chunk.mimeType,
    }),
  }));

  const uploads = [];

  for (const manifest of manifests) {
    const { data: signedUpload, error } = await service.storage
      .from("lecture-audio")
      .createSignedUploadUrl(manifest.path);

    if (error || !signedUpload?.token) {
      return NextResponse.json(
        { error: error?.message ?? "Could not create chunk upload target." },
        { status: 500 },
      );
    }

    uploads.push({
      index: manifest.index,
      path: manifest.path,
      token: signedUpload.token,
    });
  }

  const nextProcessingMetadata = {
    ...(lecture.processing_metadata && typeof lecture.processing_metadata === "object"
      ? lecture.processing_metadata
      : {}),
    audioChunks: manifests,
  };

  const { error: updateError } = await supabase
    .from("lectures")
    .update(
      {
        processing_metadata: nextProcessingMetadata,
      } as never,
    )
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    uploads,
  });
}
