import { NextResponse } from "next/server";
import { z } from "zod";

import { answerLectureChat } from "@/lib/pipeline";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const chatSchema = z.object({
  question: z.string().trim().min(3).max(1000),
});

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = chatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
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
      { error: "Chat is available after the lecture has finished processing." },
      { status: 409 },
    );
  }

  const result = await answerLectureChat({
    lectureId: id,
    userId: user.id,
    question: parsed.data.question,
  });

  return NextResponse.json(result);
}
