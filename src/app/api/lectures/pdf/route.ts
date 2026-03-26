import { NextResponse } from "next/server";

import { MAX_DOCUMENT_BYTES } from "@/lib/constants";
import { isPdfDocument, isSupportedDocumentFile } from "@/lib/document-files";
import {
  createLectureFromTextSource,
  extractTextFromDocument,
} from "@/lib/manual-lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const lectureId =
    typeof formData.get("lectureId") === "string" ? String(formData.get("lectureId")) : null;
  const inputFile = formData.get("file");
  const originalFileName =
    typeof formData.get("originalFileName") === "string"
      ? String(formData.get("originalFileName")).trim()
      : "";
  const languageHint =
    typeof formData.get("languageHint") === "string"
      ? String(formData.get("languageHint"))
      : "sl";

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

  if (inputFile.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: "The document file is too large. The current limit is 4 MB." },
      { status: 400 },
    );
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
