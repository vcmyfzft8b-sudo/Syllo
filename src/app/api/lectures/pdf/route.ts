import { NextResponse } from "next/server";

import { MAX_PDF_BYTES } from "@/lib/constants";
import { createLectureFromTextSource, extractTextFromPdf } from "@/lib/manual-lectures";
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
  const inputFile = formData.get("file");
  const languageHint =
    typeof formData.get("languageHint") === "string"
      ? String(formData.get("languageHint"))
      : "en";

  if (!(inputFile instanceof File)) {
    return NextResponse.json({ error: "Missing PDF file." }, { status: 400 });
  }

  if (!inputFile.type.includes("pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  if (inputFile.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: "The PDF file is too large. The current limit is 4 MB." },
      { status: 400 },
    );
  }

  try {
    const extracted = await extractTextFromPdf(inputFile);
    const lectureId = await createLectureFromTextSource({
      userId: user.id,
      sourceType: "pdf",
      text: extracted.text,
      blocks: extracted.pages.map((page) => ({
        label: `Page ${page.pageNumber}`,
        pageNumber: page.pageNumber,
        text: page.text,
      })),
      titleHint: extracted.title || inputFile.name.replace(/\.pdf$/i, ""),
      languageHint,
      modelMetadata: {
        importMode: "pdf",
        sourceFileName: inputFile.name,
      },
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The PDF could not be processed.",
      },
      { status: 500 },
    );
  }
}
