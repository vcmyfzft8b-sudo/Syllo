import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const STUDY_SESSION_MAX_BYTES = 128 * 1024;

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

const practiceTestStateSchema = z.object({
  currentAttemptId: z.string().uuid().nullable(),
  attemptQuestionIds: z.array(z.string().uuid()),
  textAnswers: z.record(z.string(), z.string()),
  unknownQuestionIds: z.array(z.string()),
  latestViewedAttemptId: z.string().uuid().nullable(),
  submittedAt: z.string().datetime().nullable(),
});

const updateStudySessionSchema = z.object({
  activeStudyView: z.enum(["flashcards", "quiz", "practice_test"]),
  flashcardState: flashcardStateSchema.nullable(),
  quizState: quizStateSchema.nullable(),
  practiceTestState: practiceTestStateSchema.nullable(),
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
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
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

  const parsed = await parseJsonRequest(request, updateStudySessionSchema, {
    maxBytes: STUDY_SESSION_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
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

  const { error } = await supabase
    .from("lecture_study_sessions")
    .upsert(
      {
        user_id: user.id,
        lecture_id: id,
        active_study_view: parsed.data.activeStudyView,
        flashcard_state: parsed.data.flashcardState,
        quiz_state: parsed.data.quizState,
        practice_test_state: parsed.data.practiceTestState,
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
