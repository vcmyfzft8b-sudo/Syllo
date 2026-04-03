import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const onboardingSchema = z.object({
  ageRange: z.enum(["under_16", "16_18", "19_22", "23_29", "30_plus"]),
  educationLevel: z.enum(["high_school", "university", "masters", "self_study", "other"]),
  currentAverageGrade: z.string().trim().min(1).max(40),
  targetGrade: z.string().trim().min(1).max(40),
  studyGoal: z.string().trim().min(1).max(240),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:profile:onboarding:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, onboardingSchema, {
    maxBytes: 4 * 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      age_range: parsed.data.ageRange,
      education_level: parsed.data.educationLevel,
      current_average_grade: parsed.data.currentAverageGrade,
      target_grade: parsed.data.targetGrade,
      study_goal: parsed.data.studyGoal,
      onboarding_completed_at: new Date().toISOString(),
    } as never)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
