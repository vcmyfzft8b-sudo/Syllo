import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { MAX_DOCUMENT_BYTES } from "@/lib/constants";
import { isPdfDocument, isSupportedDocumentFile } from "@/lib/document-files";
import { validateDocumentFileSignature } from "@/lib/file-validation";
import { enqueueLectureNotesGeneration } from "@/lib/jobs";
import {
  extractTextFromDocument,
  prepareLectureFromTextSource,
} from "@/lib/manual-lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  languageHintSchema,
  optionalDocumentLectureIdSchema,
  optionalOriginalFileNameSchema,
} from "@/lib/validation";

export const maxDuration = 300;
const PDF_UPLOAD_MAX_BYTES = MAX_DOCUMENT_BYTES + 256 * 1024;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:pdf:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: PDF_UPLOAD_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    return parsedFormData.response;
  }

  const formData = parsedFormData.data;
  const parsedFields = z
    .object({
      lectureId: optionalDocumentLectureIdSchema,
      originalFileName: optionalOriginalFileNameSchema,
      languageHint: z
        .union([z.string(), z.null()])
        .transform((value) => (typeof value === "string" ? value : "sl"))
        .pipe(languageHintSchema),
    })
    .safeParse({
      lectureId: formData.get("lectureId"),
      originalFileName: formData.get("originalFileName"),
      languageHint: formData.get("languageHint"),
    });
  const inputFile = formData.get("file");

  if (!parsedFields.success) {
    return NextResponse.json({ error: parsedFields.error.flatten() }, { status: 400 });
  }

  const { lectureId, originalFileName, languageHint } = parsedFields.data;

  if (!entitlement.hasPaidAccess && lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
      "trial_exhausted",
    );
  }

  if (!(inputFile instanceof File)) {
    return NextResponse.json({ error: "Manjka datoteka dokumenta." }, { status: 400 });
  }

  if (!isSupportedDocumentFile(inputFile)) {
    return NextResponse.json(
      {
        error: "Nepodprta vrsta dokumenta. Uporabi PDF, TXT, Markdown, HTML, RTF ali DOCX.",
      },
      { status: 400 },
    );
  }

  const validatedDocument = await validateDocumentFileSignature(inputFile);

  if (!validatedDocument.ok) {
    return NextResponse.json({ error: validatedDocument.error }, { status: 400 });
  }

  try {
    const sourceFileName = originalFileName || inputFile.name;

    if (lectureId) {
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
    }

    const sourceType = isPdfDocument(inputFile) ? "pdf" : "text";
    let nextLectureId = lectureId;

    if (!nextLectureId) {
      const extracted = await extractTextFromDocument(inputFile);
      nextLectureId = await prepareLectureFromTextSource({
        userId: user.id,
        sourceType,
        text: extracted.text,
        blocks: extracted.pages.map((page) => ({
          label: `Stran ${page.pageNumber}`,
          pageNumber: page.pageNumber,
          text: page.text,
        })),
        titleHint: extracted.title || sourceFileName.replace(/\.[^.]+$/i, ""),
        languageHint,
        modelMetadata: {
          importMode: sourceType === "pdf" ? "pdf" : "document",
          sourceFileName,
        },
      });

      const queuedLectureId = nextLectureId;
      after(async () => {
        try {
          await enqueueLectureNotesGeneration(queuedLectureId);
        } catch (error) {
          await markLecturePipelineFailed({ lectureId: queuedLectureId, error });
        }
      });
    } else {
      const queuedLectureId = nextLectureId;
      after(async () => {
        try {
          const extracted = await extractTextFromDocument(inputFile);
          await prepareLectureFromTextSource({
            lectureId: queuedLectureId,
            userId: user.id,
            sourceType,
            text: extracted.text,
            blocks: extracted.pages.map((page) => ({
              label: `Stran ${page.pageNumber}`,
              pageNumber: page.pageNumber,
              text: page.text,
            })),
            titleHint: extracted.title || sourceFileName.replace(/\.[^.]+$/i, ""),
            languageHint,
            modelMetadata: {
              importMode: sourceType === "pdf" ? "pdf" : "document",
              sourceFileName,
            },
          });
          await enqueueLectureNotesGeneration(queuedLectureId);
        } catch (error) {
          await markLecturePipelineFailed({ lectureId: queuedLectureId, error });
        }
      });
    }

    return NextResponse.json({ lectureId: nextLectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Dokumenta ni bilo mogoče obdelati.",
      },
      { status: 500 },
    );
  }
}
