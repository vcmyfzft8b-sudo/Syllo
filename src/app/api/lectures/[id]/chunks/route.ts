import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLectureChunkStoragePath } from "@/lib/storage";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { isSupportedAudioMimeType } from "@/lib/storage";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { createSanitizedStringSchema, routeIdParamSchema } from "@/lib/validation";

const PREPARE_CHUNKS_MAX_BYTES = 64 * 1024;

const chunkSchema = z.object({
  index: z.number().int().min(0).max(100),
  mimeType: createSanitizedStringSchema({ minLength: 1, maxLength: 120 }),
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
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:chunks:post",
    rules: rateLimitPresets.chunkUpload,
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

  const parsed = await parseJsonRequest(request, prepareChunkUploadsSchema, {
    maxBytes: PREPARE_CHUNKS_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (
    parsed.data.chunks.some(
      (chunk) => !isSupportedAudioMimeType(chunk.mimeType, `chunk-${chunk.index}`),
    )
  ) {
    return NextResponse.json({ error: "Nepodprt format zvočnega dela." }, { status: 400 });
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
        { error: error?.message ?? "Ni bilo mogoče pripraviti cilja za nalaganje zvočnega dela." },
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
