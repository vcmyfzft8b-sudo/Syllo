import { NextResponse } from "next/server";
import { z } from "zod";

import { createLectureFromTextSource, fetchReadableWebpage } from "@/lib/manual-lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createLinkLectureSchema = z.object({
  url: z.string().trim().url(),
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
  const parsed = createLinkLectureSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const webpage = await fetchReadableWebpage({
      url: parsed.data.url,
    });

    const lectureId = await createLectureFromTextSource({
      userId: user.id,
      sourceType: "link",
      text: webpage.text,
      titleHint: webpage.title,
      languageHint: parsed.data.languageHint,
      modelMetadata: {
        importMode: "link",
        sourceUrl: parsed.data.url,
      },
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The link could not be processed.",
      },
      { status: 500 },
    );
  }
}
