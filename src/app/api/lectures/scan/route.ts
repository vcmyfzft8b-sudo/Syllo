import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES, MAX_SCAN_IMAGE_COUNT } from "@/lib/constants";
import { enqueueLectureNotesGeneration, enqueueLectureScanProcessing } from "@/lib/jobs";
import { extractTextFromImage, prepareLectureFromTextSource } from "@/lib/manual-lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  isCanonicalLectureScanImageStoragePath,
  isSupportedScanImageMimeType,
} from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSanitizedStringSchema,
  languageHintSchema,
  optionalDocumentLectureIdSchema,
  optionalOriginalFileNameSchema,
  storagePathSchema,
} from "@/lib/validation";

export const maxDuration = 300;

const scanLectureFieldsSchema = z.object({
  lectureId: optionalDocumentLectureIdSchema,
  languageHint: z
    .union([z.string(), z.null()])
    .transform((value) => (typeof value === "string" ? value : "sl"))
    .pipe(languageHintSchema),
  text: z
    .union([z.string(), z.null()])
    .transform((value) => (typeof value === "string" ? value.trim() : ""))
    .refine((value) => value.length <= 120000, {
      message: "Text is too long.",
    }),
});

const storedScanImageSchema = z.object({
  index: z.number().int().min(0).max(MAX_SCAN_IMAGE_COUNT - 1),
  path: storagePathSchema,
  mimeType: createSanitizedStringSchema({ minLength: 1, maxLength: 120 }),
  fileName: optionalOriginalFileNameSchema,
  size: z.number().int().positive().max(MAX_SCAN_IMAGE_BYTES),
});

const storedScanLectureSchema = z.object({
  lectureId: optionalDocumentLectureIdSchema.pipe(z.string().uuid()),
  languageHint: languageHintSchema.default("sl"),
  text: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim())
    .refine((value) => value.length <= 120000, {
      message: "Text is too long.",
    }),
  images: z.array(storedScanImageSchema).min(1).max(MAX_SCAN_IMAGE_COUNT),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  if (!entitlement.canCreateNotes) {
    return createBillingRequiredResponse(
      "Tvoj brezplačni preizkus je porabljen. Nadgradi za novo gradivo.",
      "trial_exhausted",
    );
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:scan:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const parsed = await parseJsonRequest(request, storedScanLectureSchema, {
        maxBytes: 64 * 1024,
      });

      if (!parsed.success) {
        return parsed.response;
      }

      const { lectureId, languageHint, text, images } = parsed.data;

      if (!entitlement.hasPaidAccess && lectureId !== entitlement.trialLectureId) {
        return createBillingRequiredResponse(
          "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
          "trial_exhausted",
        );
      }

      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", lectureId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lectureError) {
        throw new Error(lectureError.message);
      }

      if (!lecture) {
        return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
      }

      for (const image of images) {
        if (
          !isSupportedScanImageMimeType(image.mimeType, image.fileName) ||
          !isCanonicalLectureScanImageStoragePath({
            path: image.path,
            userId: user.id,
            lectureId,
          })
        ) {
          return NextResponse.json(
            { error: "Neveljavna pot ali format fotografije." },
            { status: 400 },
          );
        }
      }

      const sourceFileNames = images.map(
        (image) => image.fileName || `photo-${image.index + 1}`,
      );
      const titleHint =
        images.length === 1
          ? sourceFileNames[0].replace(/\.[^.]+$/i, "")
          : `${images.length} fotografij`;
      const { error: updateError } = await supabase
        .from("lectures")
        .update(
          {
            status: "queued",
            error_message: null,
            title: titleHint,
            language_hint: languageHint,
            processing_metadata: {
              pendingScanImages: images,
              pendingScanText: text,
              processing: {
                stage: "extracting_scan_text",
                updatedAt: new Date().toISOString(),
                errorMessage: null,
              },
            },
          } as never,
        )
        .eq("id", lectureId)
        .eq("user_id", user.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      after(async () => {
        try {
          await enqueueLectureScanProcessing(lectureId);
        } catch (error) {
          await markLecturePipelineFailed({ lectureId, error });
        }
      });

      return NextResponse.json({ lectureId });
    }

    const formData = await request.formData();
    const parsedFields = scanLectureFieldsSchema.safeParse({
      lectureId: formData.get("lectureId"),
      languageHint: formData.get("languageHint"),
      text: formData.get("text"),
    });

    if (!parsedFields.success) {
      return NextResponse.json({ error: parsedFields.error.flatten() }, { status: 400 });
    }

    const fileCandidates = formData
      .getAll("files")
      .filter((candidate): candidate is File => candidate instanceof File);
    const legacyFileCandidate = formData.get("file");
    const files =
      fileCandidates.length > 0
        ? fileCandidates
        : legacyFileCandidate instanceof File
          ? [legacyFileCandidate]
          : [];

    if (files.length === 0) {
      return NextResponse.json({ error: "Najprej dodaj fotografijo za skeniranje." }, { status: 400 });
    }

    if (files.length > MAX_SCAN_IMAGE_COUNT) {
      return NextResponse.json(
        { error: `Dosegel si največ ${MAX_SCAN_IMAGE_COUNT} fotografij naenkrat.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Za skeniranje uporabi slikovno datoteko." },
          { status: 400 },
        );
      }

      if (file.size > MAX_SCAN_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Slika za skeniranje je prevelika. Omejitev je 10 MB." },
          { status: 400 },
        );
      }
    }

    if (parsedFields.data.lectureId) {
      if (
        !entitlement.hasPaidAccess &&
        parsedFields.data.lectureId !== entitlement.trialLectureId
      ) {
        return createBillingRequiredResponse(
          "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
          "trial_exhausted",
        );
      }

      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", parsedFields.data.lectureId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lectureError) {
        throw new Error(lectureError.message);
      }

      if (!lecture) {
        return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
      }

      const lectureId = parsedFields.data.lectureId;
      const filesForProcessing = files;
      const languageHint = parsedFields.data.languageHint;
      const pastedText = parsedFields.data.text.trim();

      after(async () => {
        try {
          const extractedBlocks: Array<{
            label: string;
            pageNumber: number;
            text: string;
          }> = [];

          for (const [index, file] of filesForProcessing.entries()) {
            const extracted = await extractTextFromImage(file, {
              userId: user.id,
              lectureId,
              imageIndex: index,
            });
            const text = extracted.text.trim();

            if (!text) {
              throw new Error(
                filesForProcessing.length === 1
                  ? "Na fotografiji ni bilo mogoče najti berljivega besedila."
                  : `Na fotografiji "${file.name}" ni bilo mogoče najti berljivega besedila.`,
              );
            }

            extractedBlocks.push({
              label: file.name,
              pageNumber: index + 1,
              text,
            });
          }

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
          const sourceFileNames = filesForProcessing.map((file) => file.name);
          const titleHint =
            filesForProcessing.length === 1
              ? filesForProcessing[0].name.replace(/\.[^.]+$/i, "")
              : `${filesForProcessing.length} fotografij`;

          await prepareLectureFromTextSource({
            lectureId,
            userId: user.id,
            sourceType: "text",
            text: blocks.map((block) => block.text).join("\n\n"),
            blocks,
            titleHint,
            languageHint,
            modelMetadata: {
              importMode: "scan",
              sourceFileNames,
            },
          });
          await enqueueLectureNotesGeneration(lectureId);
        } catch (error) {
          await markLecturePipelineFailed({ lectureId, error });
        }
      });

      return NextResponse.json({ lectureId });
    }

    const extractedTexts: string[] = [];
    const extractedFileNames: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Za skeniranje uporabi slikovno datoteko." },
          { status: 400 },
        );
      }

      if (file.size > MAX_SCAN_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Slika za skeniranje je prevelika. Omejitev je 10 MB." },
          { status: 400 },
        );
      }

      const extracted = await extractTextFromImage(file, {
        userId: user.id,
        imageIndex: extractedTexts.length,
      });

      if (!extracted.text.trim()) {
        return NextResponse.json(
          {
            error:
              files.length === 1
                ? "Na fotografiji ni bilo mogoče najti berljivega besedila."
                : `Na fotografiji "${file.name}" ni bilo mogoče najti berljivega besedila.`,
          },
          { status: 400 },
        );
      }

      extractedTexts.push(extracted.text.trim());
      extractedFileNames.push(file.name);
    }

    return NextResponse.json({
      text: extractedTexts.join("\n\n"),
      fileNames: extractedFileNames,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Fotografije ni bilo mogoče skenirati.",
      },
      { status: 500 },
    );
  }
}
