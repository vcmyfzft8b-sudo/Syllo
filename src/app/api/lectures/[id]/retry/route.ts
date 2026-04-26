import { after, NextResponse } from "next/server";

import { enqueueLectureNotesGeneration, enqueueLectureProcessing } from "@/lib/jobs";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { isRecord } from "@/lib/lecture-source-metadata";
import { fetchReadableWebpage, prepareLectureFromTextSource } from "@/lib/manual-lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const maxDuration = 300;

function getManualImportMetadata(processingMetadata: unknown) {
  if (!isRecord(processingMetadata) || !isRecord(processingMetadata.manualImport)) {
    return null;
  }

  return processingMetadata.manualImport;
}

function getLinkSourceUrl(processingMetadata: unknown) {
  const manualImport = getManualImportMetadata(processingMetadata);

  if (!manualImport || !isRecord(manualImport.modelMetadata)) {
    return null;
  }

  const sourceUrl = manualImport.modelMetadata.sourceUrl;

  return typeof sourceUrl === "string" && sourceUrl.length > 0 ? sourceUrl : null;
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
    route: "api:lectures:retry:post",
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

  const hasManualImport = Boolean(getManualImportMetadata(lecture.processing_metadata));

  if (lecture.source_type !== "audio" && !hasManualImport) {
    return NextResponse.json(
      { error: "Ponovni poskus za ta zapisek ni na voljo." },
      { status: 400 },
    );
  }

  if (lecture.source_type === "link") {
    const sourceUrl = getLinkSourceUrl(lecture.processing_metadata);

    if (!sourceUrl) {
      return NextResponse.json(
        { error: "Povezave ni bilo mogoče znova pripraviti." },
        { status: 400 },
      );
    }

    try {
      const webpage = await fetchReadableWebpage({ url: sourceUrl });
      await prepareLectureFromTextSource({
        lectureId: id,
        userId: user.id,
        sourceType: "link",
        text: webpage.text,
        titleHint: webpage.title || lecture.title || undefined,
        languageHint: lecture.language_hint ?? undefined,
        modelMetadata: {
          importMode: "link",
          sourceUrl,
        },
      });

      after(async () => {
        try {
          await enqueueLectureNotesGeneration(id);
        } catch (error) {
          await markLecturePipelineFailed({ lectureId: id, error });
        }
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Povezave ni bilo mogoče znova pripraviti.",
        },
        { status: 500 },
      );
    }
  }

  const nextStatus = "queued";

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
    try {
      if (lecture.source_type === "audio") {
        await enqueueLectureProcessing(id);
        return;
      }

      await enqueueLectureNotesGeneration(id);
    } catch (error) {
      await markLecturePipelineFailed({ lectureId: id, error });
    }
  });

  return NextResponse.json({ ok: true });
}
