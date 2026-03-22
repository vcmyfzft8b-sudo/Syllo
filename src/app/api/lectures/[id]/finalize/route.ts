import { after, NextResponse } from "next/server";
import { z } from "zod";

import { enqueueLectureProcessing } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const finalizeSchema = z.object({
  path: z.string().min(3),
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

  const { id } = await context.params;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = finalizeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("lectures")
    .update(
      {
        storage_path: parsed.data.path,
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
