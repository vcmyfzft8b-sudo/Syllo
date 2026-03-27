import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { languageHintSchema } from "@/lib/validation";

const createManualLectureSchema = z.object({
  sourceType: z.enum(["text", "pdf", "link"]),
  languageHint: languageHintSchema.default("sl"),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:manual:post",
    rules: rateLimitPresets.create,
    userId: user.id,
  });

  if (limited) {
    return limited;
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
