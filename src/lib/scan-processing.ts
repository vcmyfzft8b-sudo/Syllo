import "server-only";

import { MAX_SCAN_IMAGE_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import { extractTextFromImage, prepareLectureFromTextSource } from "@/lib/manual-lectures";
import {
  isCanonicalLectureScanImageStoragePath,
  isSupportedScanImageMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const SCAN_OCR_CONCURRENCY = 3;

type StoredScanImage = {
  index: number;
  path: string;
  mimeType: string;
  fileName?: string | null;
  size: number;
};

export type StoredScanProcessingResult = {
  needsNotesGeneration: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePendingScanImages(value: unknown): StoredScanImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const index = typeof item.index === "number" ? item.index : null;
    const path = typeof item.path === "string" ? item.path : null;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : null;
    const fileName = typeof item.fileName === "string" ? item.fileName : null;
    const size = typeof item.size === "number" ? item.size : null;

    if (index == null || !path || !mimeType || size == null) {
      return [];
    }

    return [{ index, path, mimeType, fileName, size }];
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

async function downloadStoredScanImage(image: StoredScanImage) {
  const normalizedMimeType = normalizeUploadScanImageMimeType({
    mimeType: image.mimeType,
    fileName: image.fileName,
  });

  const { data: blob, error } = await createSupabaseServiceRoleClient()
    .storage
    .from(STORAGE_BUCKET)
    .download(image.path);

  if (error || !blob) {
    throw new Error(error?.message ?? "Fotografije ni bilo mogoče prebrati.");
  }

  if (blob.size <= 0 || blob.size > MAX_SCAN_IMAGE_BYTES) {
    throw new Error("Slika za skeniranje je prevelika ali prazna.");
  }

  return new File([blob], image.fileName || `photo-${image.index + 1}`, {
    type: normalizedMimeType,
  });
}

export async function processStoredScanLecture(
  params: { lectureId: string },
): Promise<StoredScanProcessingResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id, user_id, source_type, language_hint, processing_metadata")
    .eq("id", params.lectureId)
    .single();

  if (lectureError || !lecture) {
    throw new Error(lectureError?.message ?? "Zapiska ni bilo mogoče najti.");
  }

  const lectureRow = lecture as {
    id: string;
    user_id: string;
    source_type: string | null;
    language_hint: string | null;
    processing_metadata: unknown;
  };
  const metadata = isRecord(lectureRow.processing_metadata)
    ? lectureRow.processing_metadata
    : {};
  const manualImport = isRecord(metadata.manualImport) ? metadata.manualImport : null;
  const images = parsePendingScanImages(metadata.pendingScanImages).sort(
    (left, right) => left.index - right.index,
  );
  const pastedText =
    typeof metadata.pendingScanText === "string" ? metadata.pendingScanText.trim() : "";

  if (images.length === 0) {
    const manualImportModelMetadata = isRecord(manualImport?.modelMetadata)
      ? manualImport.modelMetadata
      : null;
    const hasPreparedScanImport =
      manualImportModelMetadata?.importMode === "scan" &&
      typeof manualImport?.text === "string" &&
      manualImport.text.trim().length > 0;

    if (hasPreparedScanImport) {
      const { data: artifact, error: artifactError } = await supabase
        .from("lecture_artifacts")
        .select("lecture_id")
        .eq("lecture_id", lectureRow.id)
        .maybeSingle();

      if (artifactError) {
        throw new Error(artifactError.message);
      }

      if (artifact) {
        const { error: updateError } = await supabase
          .from("lectures")
          .update(
            {
              status: "ready",
              error_message: null,
              processing_metadata: {
                ...metadata,
                processing: {
                  stage: "ready",
                  updatedAt: new Date().toISOString(),
                  errorMessage: null,
                },
              },
            } as never,
          )
          .eq("id", lectureRow.id)
          .eq("user_id", lectureRow.user_id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        return { needsNotesGeneration: false };
      }

      return { needsNotesGeneration: true };
    }

    throw new Error("Ni fotografij za obdelavo.");
  }

  for (const image of images) {
    if (
      !isSupportedScanImageMimeType(image.mimeType, image.fileName) ||
      !isCanonicalLectureScanImageStoragePath({
        path: image.path,
        userId: lectureRow.user_id,
        lectureId: lectureRow.id,
      })
    ) {
      throw new Error("Neveljavna pot ali format fotografije.");
    }
  }

  const sourceFileNames = images.map((image) => image.fileName || `photo-${image.index + 1}`);
  const titleHint =
    images.length === 1
      ? sourceFileNames[0].replace(/\.[^.]+$/i, "")
      : `${images.length} fotografij`;

  const { error: statusError } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        title: titleHint,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: "extracting_scan_text",
            updatedAt: new Date().toISOString(),
            errorMessage: null,
          },
        },
      } as never,
    )
    .eq("id", lectureRow.id)
    .eq("user_id", lectureRow.user_id);

  if (statusError) {
    throw new Error(statusError.message);
  }

  const extractedBlocks = await mapWithConcurrency(
    images,
    SCAN_OCR_CONCURRENCY,
    async (image) => {
      const file = await downloadStoredScanImage(image);
      const extracted = await extractTextFromImage(file);
      const text = extracted.text.trim();

      if (!text) {
        throw new Error(
          images.length === 1
            ? "Na fotografiji ni bilo mogoče najti berljivega besedila."
            : `Na fotografiji "${image.fileName || `photo-${image.index + 1}`}" ni bilo mogoče najti berljivega besedila.`,
        );
      }

      return {
        label: image.fileName || `photo-${image.index + 1}`,
        pageNumber: image.index + 1,
        text,
      };
    },
  );

  const blocks = pastedText
    ? [
        ...extractedBlocks,
        {
          label: "Prilepljeno besedilo",
          pageNumber: extractedBlocks.length + 1,
        text: pastedText,
      },
    ]
    : extractedBlocks;

  await prepareLectureFromTextSource({
    lectureId: lectureRow.id,
    userId: lectureRow.user_id,
    sourceType: "text",
    text: blocks.map((block) => block.text).join("\n\n"),
    blocks,
    titleHint,
    languageHint: lectureRow.language_hint ?? "sl",
    modelMetadata: {
      importMode: "scan",
      sourceFileNames,
      sourceImageUploads: images.map((image) => ({
        index: image.index,
        path: image.path,
        fileName: image.fileName,
        mimeType: image.mimeType,
        size: image.size,
      })),
    },
  });

  return { needsNotesGeneration: true };
}
