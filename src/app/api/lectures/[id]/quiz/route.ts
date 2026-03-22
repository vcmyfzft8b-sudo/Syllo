import { after, NextResponse } from "next/server";

import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLectureQuizGeneration } from "@/lib/jobs";
import { queueLectureQuizGeneration } from "@/lib/quiz";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    lectureId: detail.lecture.id,
    status: detail.quizAsset?.status ?? null,
    quizAsset: detail.quizAsset,
    quizQuestions: detail.quizQuestions,
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Quiz creation is available after the note is ready." },
      { status: 409 },
    );
  }

  try {
    await queueLectureQuizGeneration(id);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Quiz creation could not be queued.",
      },
      { status: 500 },
    );
  }

  after(async () => {
    await enqueueLectureQuizGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
