import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const flashcardConfidenceSchema = z.enum(["again", "good", "easy"]);

const flashcardStateSchema = z.object({
  reviewQueue: z.array(z.string()),
  repeatQueue: z.array(z.string()),
  reviewCycle: z.number().int().min(1),
  cycleCardCount: z.number().int().min(0),
  roundSummary: z
    .object({
      cycle: z.number().int().min(1),
      total: z.number().int().min(0),
      known: z.number().int().min(0),
      missed: z.number().int().min(0),
    })
    .nullable(),
  sessionResults: z.record(
    z.string(),
    z.object({
      attempts: z.number().int().min(1),
      firstConfidence: flashcardConfidenceSchema,
      latestConfidence: flashcardConfidenceSchema,
    }),
  ),
});

const quizStateSchema = z.object({
  quizQueue: z.array(z.string()),
  quizRound: z.number().int().min(1),
  quizRoundCount: z.number().int().min(0),
  roundSummary: z
    .object({
      cycle: z.number().int().min(1),
      total: z.number().int().min(0),
      correct: z.number().int().min(0),
      missed: z.number().int().min(0),
      missedQuestionIds: z.array(z.string()),
    })
    .nullable(),
  activeQuestionIndex: z.number().int().min(0),
  selections: z.record(z.string(), z.number().int().min(0)),
  optionOrders: z.record(z.string(), z.array(z.number().int().min(0))),
});

const updateStudySessionSchema = z.object({
  activeStudyView: z.enum(["flashcards", "quiz"]),
  flashcardState: flashcardStateSchema.nullable(),
  quizState: quizStateSchema.nullable(),
});

async function updateStudySession(
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
    route: "api:lectures:study-session:write",
    rules: rateLimitPresets.studySession,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const body = await request.json().catch(() => null);
  const parsed = updateStudySessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid lecture id." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("lecture_study_sessions")
    .upsert(
      {
        user_id: user.id,
        lecture_id: id,
        active_study_view: parsed.data.activeStudyView,
        flashcard_state: parsed.data.flashcardState,
        quiz_state: parsed.data.quizState,
      } as never,
      { onConflict: "user_id,lecture_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateStudySession(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return updateStudySession(request, context);
}
