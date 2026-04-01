import { after, NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enqueueLecturePracticeTestGeneration } from "@/lib/jobs";
import {
  describePracticeTestError,
  queueLecturePracticeTestGeneration,
} from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const maxDuration = 300;

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
    return createBillingRequiredResponse("Pred ustvarjanjem novih preizkusov znanja izberi paket.");
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:regenerate:post",
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
    await queueLecturePracticeTestGeneration(parsedParams.data.id);
  } catch (error) {
    return NextResponse.json(
      {
        error: describePracticeTestError(error),
      },
      { status: 500 },
    );
  }

  after(async () => {
    await enqueueLecturePracticeTestGeneration(parsedParams.data.id, true);
  });

  return NextResponse.json({ ok: true });
}
