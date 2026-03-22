import { after, NextResponse } from "next/server";

import { enqueueLectureProcessing } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

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

  if (lecture.source_type !== "audio") {
    return NextResponse.json(
      { error: "Retry is currently supported only for audio notes." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
      } as never,
    )
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    await enqueueLectureProcessing(id);
  });

  return NextResponse.json({ ok: true });
}
