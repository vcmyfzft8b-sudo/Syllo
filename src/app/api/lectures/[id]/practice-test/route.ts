import { after, NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLecturePracticeTestGeneration } from "@/lib/jobs";
import {
  describePracticeTestError,
  queueLecturePracticeTestGeneration,
} from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const maxDuration = 300;

export async function GET(
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
    return createBillingRequiredResponse("Pred ustvarjanjem preizkusov znanja izberi paket.");
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:get",
    rules: rateLimitPresets.detailRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const detail = await getLectureDetailForUser({
    lectureId: parsedParams.data.id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  return NextResponse.json({
    lectureId: detail.lecture.id,
    status: detail.practiceTestAsset?.status ?? null,
    practiceTestAsset: detail.practiceTestAsset,
    practiceTestQuestions: detail.practiceTestQuestions,
    practiceTestAttempts: detail.practiceTestAttempts,
    practiceTestHistorySummary: detail.practiceTestHistorySummary,
  });
}

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
    route: "api:lectures:practice-test:post",
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

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Preizkusi znanja so na voljo, ko je zapisek pripravljen." },
      { status: 409 },
    );
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
    await enqueueLecturePracticeTestGeneration(parsedParams.data.id);
  });

  return NextResponse.json({ ok: true });
}
