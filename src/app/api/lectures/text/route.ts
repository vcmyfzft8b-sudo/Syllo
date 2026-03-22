import { NextResponse } from "next/server";
import { z } from "zod";

import { createLectureFromTextSource } from "@/lib/manual-lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createTextLectureSchema = z.object({
  text: z.string().trim().min(120).max(120000),
  languageHint: z.string().trim().min(2).max(10).default("en"),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createTextLectureSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const lectureId = await createLectureFromTextSource({
      userId: user.id,
      sourceType: "text",
      text: parsed.data.text,
      languageHint: parsed.data.languageHint,
      modelMetadata: {
        importMode: "text",
      },
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The text could not be processed.",
      },
      { status: 500 },
    );
  }
}
