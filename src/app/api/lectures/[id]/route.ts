import { after, NextResponse } from "next/server";
import { z } from "zod";

import { parseAudioChunkManifest } from "@/lib/audio-processing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLectureNotesGeneration } from "@/lib/jobs";
import { isRecord } from "@/lib/lecture-source-metadata";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { extractScanImageStoragePaths } from "@/lib/scan-image-uploads";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { lectureTitleSchema, routeIdParamSchema } from "@/lib/validation";

const UPDATE_LECTURE_MAX_BYTES = 8 * 1024;
const STALE_NOTES_GENERATION_MS = 6 * 60 * 1000;

const updateLectureSchema = z.object({
  title: lectureTitleSchema,
});

function getLectureProcessingUpdatedAt(processingMetadata: unknown) {
  if (!isRecord(processingMetadata) || !isRecord(processingMetadata.processing)) {
    return 0;
  }

  const updatedAt = processingMetadata.processing.updatedAt;

  if (typeof updatedAt !== "string") {
    return 0;
  }

  const timestamp = Date.parse(updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export async function GET(
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
    route: "api:lectures:detail:get",
    rules: rateLimitPresets.detailRead,
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
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const processingUpdatedAt =
    getLectureProcessingUpdatedAt(detail.lecture.processing_metadata) ||
    Date.parse(detail.lecture.updated_at);

  if (
    detail.lecture.status === "generating_notes" &&
    !detail.artifact &&
    detail.transcript.length > 0 &&
    Date.now() - processingUpdatedAt > STALE_NOTES_GENERATION_MS
  ) {
    after(async () => {
      await enqueueLectureNotesGeneration(detail.lecture.id);
    });
  }

  return NextResponse.json(detail);
}

export async function DELETE(
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
    route: "api:lectures:detail:delete",
    rules: rateLimitPresets.mutate,
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

  const { error } = await supabase
    .from("lectures")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const chunkPaths = parseAudioChunkManifest(
    lecture.processing_metadata && typeof lecture.processing_metadata === "object"
      ? (lecture.processing_metadata as Record<string, unknown>).audioChunks
      : null,
  ).map((chunk) => chunk.path);
  const scanImagePaths = extractScanImageStoragePaths(lecture.processing_metadata);
  const storagePaths = lecture.storage_path
    ? [lecture.storage_path, ...chunkPaths, ...scanImagePaths]
    : [...chunkPaths, ...scanImagePaths];

  if (storagePaths.length > 0) {
    await createSupabaseServiceRoleClient()
      .storage
      .from("lecture-audio")
      .remove(storagePaths);
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
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
    route: "api:lectures:detail:patch",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, updateLectureSchema, {
    maxBytes: UPDATE_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
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

  const { error } = await supabase
    .from("lectures")
    .update({ title: parsed.data.title } as never)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, title: parsed.data.title });
}
