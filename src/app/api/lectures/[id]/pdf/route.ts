import { NextResponse } from "next/server";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

import { getLectureDetailForUser } from "@/lib/lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatLectureDuration, formatRelativeDate } from "@/lib/utils";

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "").trim() || "note";
}

async function buildPdfBuffer(docDefinition: TDocumentDefinitions) {
  const [{ default: PdfPrinter }, { default: pdfFonts }] = await Promise.all([
    import("pdfmake/js/Printer"),
    import("pdfmake/build/vfs_fonts"),
  ]);

  const printer = new PdfPrinter(
    {
      Roboto: {
        normal: "Roboto-Regular.ttf",
        bold: "Roboto-Medium.ttf",
        italics: "Roboto-Italic.ttf",
        bolditalics: "Roboto-MediumItalic.ttf",
      },
    },
    pdfFonts,
  );

  const pdfDocument = await printer.createPdfKitDocument(docDefinition);

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    pdfDocument.on("data", (chunk) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
        return;
      }

      chunks.push(Buffer.from(chunk as Uint8Array));
    });
    pdfDocument.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    pdfDocument.on("error", reject);
    pdfDocument.end();
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail || !detail.artifact) {
    return NextResponse.json({ error: "Lecture not found." }, { status: 404 });
  }

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: detail.lecture.title ?? "Lecture",
    },
    content: [
      {
        text: detail.lecture.title ?? "Lecture",
        style: "title",
      },
      {
        text: `${formatRelativeDate(detail.lecture.created_at)}  •  ${formatLectureDuration(detail.lecture.duration_seconds)}`,
        style: "meta",
      },
      {
        text: "Summary",
        style: "heading",
      },
      {
        text: detail.artifact.summary,
        style: "body",
      },
      {
        text: "Key topics",
        style: "heading",
      },
      {
        ul: detail.artifact.key_topics,
        style: "body",
      },
      {
        text: "Notes",
        style: "heading",
      },
      {
        text: stripMarkdown(detail.artifact.structured_notes_md),
        style: "body",
      },
    ],
    styles: {
      title: { fontSize: 22, bold: true, margin: [0, 0, 0, 8] },
      meta: { fontSize: 10, color: "#6f7280", margin: [0, 0, 0, 18] },
      heading: { fontSize: 13, bold: true, margin: [0, 12, 0, 6] },
      body: { fontSize: 11, lineHeight: 1.45, color: "#111111" },
    },
    defaultStyle: {
      fontSize: 11,
    },
    pageMargins: [40, 48, 40, 48],
  };

  const pdfBuffer = await buildPdfBuffer(docDefinition);
  const fileName = sanitizeFileName(detail.lecture.title ?? "note");

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
