import { NextResponse } from "next/server";
import { z } from "zod";

import { parseAudioChunkManifest } from "@/lib/audio-processing";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "@/lib/constants";
import {
  buildLectureStoragePath,
  isSupportedAudioMimeType,
  normalizeUploadAudioMimeType,
} from "@/lib/storage";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { languageHintSchema, optionalUploadFileNameSchema } from "@/lib/validation";

const createLectureSchema = z.object({
  mimeType: z.string().min(1),
  fileName: optionalUploadFileNameSchema,
  size: z.number().int().positive().max(MAX_AUDIO_BYTES),
  durationSeconds: z.number().positive().max(MAX_AUDIO_SECONDS),
  languageHint: languageHintSchema.default("sl"),
});

const deleteLecturesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createLectureSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const mimeType = normalizeUploadAudioMimeType({
    mimeType: parsed.data.mimeType,
    fileName: parsed.data.fileName,
  });

  if (!isSupportedAudioMimeType(mimeType, parsed.data.fileName)) {
    return NextResponse.json(
      { error: "Unsupported audio format." },
      { status: 400 },
    );
  }

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: user.id,
        source_type: "audio",
        status: "uploading",
        language_hint: parsed.data.languageHint,
        duration_seconds: Math.round(parsed.data.durationSeconds),
      } as never,
    )
    .select("id")
    .single();

  if (lectureError || !lecture) {
    return NextResponse.json(
      { error: lectureError?.message ?? "Could not create lecture." },
      { status: 500 },
    );
  }

  const createdLecture = lecture as { id: string };

  const path = buildLectureStoragePath({
    userId: user.id,
    lectureId: createdLecture.id,
    mimeType,
  });

  const service = createSupabaseServiceRoleClient();
  const { data: signedUpload, error: signedError } = await service.storage
    .from("lecture-audio")
    .createSignedUploadUrl(path);

  if (signedError || !signedUpload?.token) {
    return NextResponse.json(
      { error: signedError?.message ?? "Could not create upload target." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    lectureId: createdLecture.id,
    path,
    token: signedUpload.token,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = deleteLecturesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: ownedLectures, error: ownedLecturesError } = await supabase
    .from("lectures")
    .select("id, storage_path, processing_metadata")
    .eq("user_id", user.id)
    .in("id", parsed.data.ids);

  if (ownedLecturesError) {
    return NextResponse.json({ error: ownedLecturesError.message }, { status: 500 });
  }

  const ownedLectureRows = (ownedLectures ?? []) as Array<{
    id: string;
    storage_path: string | null;
    processing_metadata: unknown;
  }>;
  const lectureIds = ownedLectureRows.map((lecture) => lecture.id);

  if (lectureIds.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("lectures")
    .delete()
    .eq("user_id", user.id)
    .in("id", lectureIds);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const storagePaths = ownedLectureRows
    .map((lecture) => lecture.storage_path)
    .filter((path): path is string => Boolean(path));
  const chunkPaths = ownedLectureRows.flatMap((lecture) =>
    parseAudioChunkManifest(
      lecture.processing_metadata && typeof lecture.processing_metadata === "object"
        ? (lecture.processing_metadata as Record<string, unknown>).audioChunks
        : null,
    ).map((chunk) => chunk.path),
  );

  if (storagePaths.length > 0 || chunkPaths.length > 0) {
    await createSupabaseServiceRoleClient()
      .storage
      .from("lecture-audio")
      .remove([...storagePaths, ...chunkPaths]);
  }

  return NextResponse.json({ ok: true, deletedCount: lectureIds.length });
}
