import { NextResponse } from "next/server";

import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLectureQuizGeneration } from "@/lib/jobs";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

  const service = createSupabaseServiceRoleClient();
  const { error } = await service
    .from("lecture_quiz_assets")
    .upsert(
      {
        lecture_id: id,
        status: "queued",
        error_message: null,
        model_metadata: {},
      } as never,
      {
        onConflict: "lecture_id",
      },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await enqueueLectureQuizGeneration(id);

  return NextResponse.json({ ok: true });
}
