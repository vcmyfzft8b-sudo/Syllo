import { NextResponse } from "next/server";
import { z } from "zod";

import { createLectureFromTextSource } from "@/lib/manual-lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createTextLectureSchema = z.object({
  lectureId: z.string().uuid().optional(),
  text: z.string().trim().min(120).max(120000),
  languageHint: z.string().trim().min(2).max(10).default("sl"),
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
    if (parsed.data.lectureId) {
      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", parsed.data.lectureId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lectureError) {
        throw new Error(lectureError.message);
      }

      if (!lecture) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const lectureId = await createLectureFromTextSource({
      lectureId: parsed.data.lectureId,
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
