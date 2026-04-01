import { after, NextResponse } from "next/server";

import { enqueueLectureProcessing, enqueueLectureProcessingStage } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:retry:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
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

  const hasManualImport =
    lecture.processing_metadata &&
    typeof lecture.processing_metadata === "object" &&
    !Array.isArray(lecture.processing_metadata) &&
    "manualImport" in lecture.processing_metadata;

  if (lecture.source_type !== "audio" && !hasManualImport) {
    return NextResponse.json(
      { error: "Retry is not available for this note." },
      { status: 400 },
    );
  }

  const nextStatus = lecture.source_type === "audio" ? "queued" : "generating_notes";

  const { error } = await supabase
    .from("lectures")
    .update(
      {
        status: nextStatus,
        error_message: null,
      } as never,
    )
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    if (lecture.source_type === "audio") {
      await enqueueLectureProcessing(id);
      return;
    }

    await enqueueLectureProcessingStage({
      lectureId: id,
      stage: "generate_notes",
    });
  });

  return NextResponse.json({ ok: true });
}
