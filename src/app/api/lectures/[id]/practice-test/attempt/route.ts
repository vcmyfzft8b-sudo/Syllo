import { NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { createPracticeTestAttempt } from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:attempt:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;

  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "practice_test");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa je preizkus znanja na voljo samo za tvoje poskusno gradivo.",
      access.code,
    );
  }

  try {
    const attempt = await createPracticeTestAttempt({
      lectureId: id,
      userId: user.id,
    });

    return NextResponse.json(attempt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preizkusa znanja ni bilo mogoče zagnati." },
      { status: 400 },
    );
  }
}
