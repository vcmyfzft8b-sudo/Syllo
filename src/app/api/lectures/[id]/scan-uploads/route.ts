import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_SCAN_IMAGE_BYTES, MAX_SCAN_IMAGE_COUNT, STORAGE_BUCKET } from "@/lib/constants";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  buildLectureScanImageStoragePath,
  isSupportedScanImageMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import {
  createSanitizedStringSchema,
  optionalUploadFileNameSchema,
  routeIdParamSchema,
} from "@/lib/validation";

const PREPARE_SCAN_UPLOADS_MAX_BYTES = 32 * 1024;

const scanUploadFileSchema = z.object({
  index: z.number().int().min(0).max(MAX_SCAN_IMAGE_COUNT - 1),
  mimeType: createSanitizedStringSchema({ minLength: 1, maxLength: 120 }),
  fileName: optionalUploadFileNameSchema,
  size: z.number().int().positive().max(MAX_SCAN_IMAGE_BYTES),
});

const prepareScanUploadsSchema = z.object({
  files: z.array(scanUploadFileSchema).min(1).max(MAX_SCAN_IMAGE_COUNT),
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
    route: "api:lectures:scan-uploads:post",
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

  const parsed = await parseJsonRequest(request, prepareScanUploadsSchema, {
    maxBytes: PREPARE_SCAN_UPLOADS_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (
    parsed.data.files.some(
      (file) => !isSupportedScanImageMimeType(file.mimeType, file.fileName),
    )
  ) {
    return NextResponse.json(
      { error: "Nepodprt format fotografije." },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const manifests = parsed.data.files.map((file) => {
    const mimeType = normalizeUploadScanImageMimeType({
      mimeType: file.mimeType,
      fileName: file.fileName,
    });

    return {
      index: file.index,
      fileName: file.fileName ?? `photo-${file.index + 1}`,
      mimeType,
      size: file.size,
      path: buildLectureScanImageStoragePath({
        userId: user.id,
        lectureId: id,
        index: file.index,
        mimeType,
      }),
    };
  });

  const uploads = [];

  for (const manifest of manifests) {
    const { data: signedUpload, error } = await service.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(manifest.path);

    if (error || !signedUpload?.token) {
      return NextResponse.json(
        { error: error?.message ?? "Ni bilo mogoče pripraviti nalaganja fotografij." },
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
    pendingScanImages: manifests,
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
