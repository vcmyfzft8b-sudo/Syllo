import { NextResponse } from "next/server";
import { z } from "zod";

import type { FlashcardProgressRow } from "@/lib/database.types";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const progressSchema = z.object({
  confidenceBucket: z.enum(["again", "good", "easy"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:flashcards:progress:post",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const body = await request.json().catch(() => null);
  const parsed = progressSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid flashcard id." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const { data: flashcard, error: flashcardError } = await supabase
    .from("flashcards")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (flashcardError) {
    return NextResponse.json({ error: flashcardError.message }, { status: 500 });
  }

  if (!flashcard) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("flashcard_progress")
    .select("*")
    .eq("user_id", user.id)
    .eq("flashcard_id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingProgress = (existing ?? null) as FlashcardProgressRow | null;
  const nextReviewCount = (existingProgress?.review_count ?? 0) + 1;
  const lastReviewedAt = new Date().toISOString();

  const { data: progress, error: progressError } = await supabase
    .from("flashcard_progress")
    .upsert(
      {
        user_id: user.id,
        flashcard_id: id,
        confidence_bucket: parsed.data.confidenceBucket,
        review_count: nextReviewCount,
        last_reviewed_at: lastReviewedAt,
      } as never,
      {
        onConflict: "user_id,flashcard_id",
      },
    )
    .select("*")
    .single();

  if (progressError) {
    return NextResponse.json({ error: progressError.message }, { status: 500 });
  }

  return NextResponse.json({ progress });
}
