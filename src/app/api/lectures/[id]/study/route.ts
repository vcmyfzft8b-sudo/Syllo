import { after, NextResponse } from "next/server";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture, getLectureDetailForUser } from "@/lib/lectures";
import { enqueueLectureStudyGeneration } from "@/lib/jobs";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
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

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:study:get",
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

  const { id } = parsedParams.data;
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa so učna orodja na voljo samo za tvoje poskusno gradivo.",
      access.code,
    );
  }

  return NextResponse.json({
    lectureId: detail.lecture.id,
    status: detail.studyAsset?.status ?? null,
    studyAsset: detail.studyAsset,
    studySections: detail.studySections,
    flashcards: detail.flashcards,
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
    route: "api:lectures:study:post",
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

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa so učna orodja na voljo samo za tvoje poskusno gradivo.",
      access.code,
    );
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Učna orodja so na voljo, ko je zapisek pripravljen." },
      { status: 409 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { error } = await service
    .from("lecture_study_assets")
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

  after(async () => {
    await enqueueLectureStudyGeneration(id);
  });

  return NextResponse.json({ ok: true });
}
