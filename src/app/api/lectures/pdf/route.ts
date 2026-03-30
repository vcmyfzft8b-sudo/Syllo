import { NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { MAX_DOCUMENT_BYTES } from "@/lib/constants";
import { isPdfDocument, isSupportedDocumentFile } from "@/lib/document-files";
import { validateDocumentFileSignature } from "@/lib/file-validation";
import {
  createLectureFromTextSource,
  extractTextFromDocument,
} from "@/lib/manual-lectures";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasPaidAccessForUserId(user.id))) {
    return createBillingRequiredResponse("Choose a plan before importing documents.");
  }

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

  if (!(inputFile instanceof File)) {
    return NextResponse.json({ error: "Missing document file." }, { status: 400 });
  }

  if (!isSupportedDocumentFile(inputFile)) {
    return NextResponse.json(
      {
        error: "Unsupported document type. Use PDF, TXT, Markdown, HTML, RTF, or DOCX.",
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
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const extracted = await extractTextFromDocument(inputFile);
    const sourceType = isPdfDocument(inputFile) ? "pdf" : "text";
    const nextLectureId = await createLectureFromTextSource({
      lectureId: lectureId ?? undefined,
      userId: user.id,
      sourceType,
      text: extracted.text,
      blocks: extracted.pages.map((page) => ({
        label: `Page ${page.pageNumber}`,
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

    return NextResponse.json({ lectureId: nextLectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The document could not be processed.",
      },
      { status: 500 },
    );
  }
}
