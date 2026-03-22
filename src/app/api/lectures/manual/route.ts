import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const createManualLectureSchema = z.object({
  sourceType: z.enum(["text", "pdf", "link"]),
  languageHint: z.string().trim().min(2).max(10).default("sl"),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createManualLectureSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: lecture, error } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: user.id,
        source_type: parsed.data.sourceType,
        status: "generating_notes",
        language_hint: parsed.data.languageHint,
      } as never,
    )
    .select("id")
    .single();

  if (error || !lecture) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create note." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    lectureId: (lecture as { id: string }).id,
  });
}
