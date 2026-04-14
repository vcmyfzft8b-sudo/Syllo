import "server-only";

import { inngest } from "@/inngest/client";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  runLecturePipeline,
} from "@/lib/pipeline";
import { generateLecturePracticeTest } from "@/lib/practice-test";
import { generateLectureQuiz } from "@/lib/quiz";
import { processStoredScanLecture } from "@/lib/scan-processing";
import { getServerEnv } from "@/lib/server-env";
import { generateLectureFlashcards } from "@/lib/study";

export type LectureProcessingStage = "transcribe" | "generate_notes";

const INTERNAL_LECTURE_PROCESSING_PATH = "/api/internal/lectures/process";
const INTERNAL_LECTURE_SCAN_PATH = "/api/internal/lectures/scan";
const INTERNAL_LECTURE_PRACTICE_TEST_PATH = "/api/internal/lectures/practice-test";

export async function enqueueLectureProcessingStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  const env = getServerEnv();

  if (!env.NEXT_PUBLIC_SITE_URL || !env.INTERNAL_JOB_SECRET) {
    return false;
  }

  const response = await fetch(
    new URL(INTERNAL_LECTURE_PROCESSING_PATH, env.NEXT_PUBLIC_SITE_URL),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-job-secret": env.INTERNAL_JOB_SECRET,
      },
      body: JSON.stringify(params),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let message = `Lecture processing stage ${params.stage} could not be started.`;

    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // Ignore JSON parse errors for non-JSON responses.
    }

    throw new Error(message);
  }

  return true;
}

async function tryEnqueueLectureProcessingStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  try {
    return await enqueueLectureProcessingStage(params);
  } catch (error) {
    console.error("Lecture processing stage could not be started", {
      lectureId: params.lectureId,
      stage: params.stage,
      error,
    });
    return false;
  }
}

async function enqueueInternalLectureJob(params: {
  lectureId: string;
  path: string;
  regenerate?: boolean;
}) {
  const env = getServerEnv();

  if (!env.NEXT_PUBLIC_SITE_URL || !env.INTERNAL_JOB_SECRET) {
    return false;
  }

  const response = await fetch(new URL(params.path, env.NEXT_PUBLIC_SITE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-job-secret": env.INTERNAL_JOB_SECRET,
    },
    body: JSON.stringify({
      lectureId: params.lectureId,
      ...(typeof params.regenerate === "boolean" ? { regenerate: params.regenerate } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Lecture background job could not be started for ${params.path}.`;

    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // Ignore non-JSON responses.
    }

    throw new Error(message);
  }

  return true;
}

async function tryEnqueueInternalLectureJob(params: {
  lectureId: string;
  path: string;
  regenerate?: boolean;
}) {
  try {
    return await enqueueInternalLectureJob(params);
  } catch (error) {
    console.error("Lecture background job could not be started", {
      lectureId: params.lectureId,
      path: params.path,
      regenerate: params.regenerate,
      error,
    });
    return false;
  }
}

export async function enqueueLectureProcessing(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/process.requested",
      data: { lectureId },
    });
    return;
  }

  if (await tryEnqueueLectureProcessingStage({ lectureId, stage: "transcribe" })) {
    return;
  }

  await runLecturePipeline({ lectureId }).catch(() => {
    // Errors are persisted on the lecture row by the pipeline.
  });
}

export async function enqueueLectureNotesGeneration(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/notes.requested",
      data: { lectureId },
    });
    return;
  }

  if (await tryEnqueueLectureProcessingStage({ lectureId, stage: "generate_notes" })) {
    return;
  }

  await generateLectureNotesFromStoredTranscript({ lectureId }).catch(async (error) => {
    await markLecturePipelineFailed({ lectureId, error });
  });
}

export async function enqueueLectureScanProcessing(lectureId: string) {
  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_SCAN_PATH,
    })
  ) {
    return;
  }

  await processStoredScanLecture({ lectureId }).catch(async (error) => {
    await markLecturePipelineFailed({ lectureId, error });
  });
}

export async function enqueueLectureStudyGeneration(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/study.requested",
      data: { lectureId },
    });
    return;
  }

  await generateLectureFlashcards({ lectureId }).catch((error) => {
    console.error("Lecture study generation failed", { lectureId, error });
  });
}

export async function enqueueLectureQuizGeneration(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/quiz.requested",
      data: { lectureId },
    });
    return;
  }

  await generateLectureQuiz({ lectureId }).catch((error) => {
    console.error("Lecture quiz generation failed", { lectureId, error });
  });
}

export async function enqueueLecturePracticeTestGeneration(
  lectureId: string,
  regenerate = false,
) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/practice-test.requested",
      data: { lectureId, regenerate },
    });
    return;
  }

  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_PRACTICE_TEST_PATH,
      regenerate,
    })
  ) {
    return;
  }

  await generateLecturePracticeTest({ lectureId, regenerate }).catch((error) => {
    console.error("Lecture practice-test generation failed", { lectureId, regenerate, error });
  });
}
