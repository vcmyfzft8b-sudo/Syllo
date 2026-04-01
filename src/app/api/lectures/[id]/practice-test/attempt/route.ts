import { NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
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

  if (!(await hasPaidAccessForUserId(user.id))) {
    return createBillingRequiredResponse("Pred začetkom preizkusov znanja izberi paket.");
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

  const lecture = await ensureUserOwnsLecture({
    lectureId: parsedParams.data.id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  try {
    const attempt = await createPracticeTestAttempt({
      lectureId: parsedParams.data.id,
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
