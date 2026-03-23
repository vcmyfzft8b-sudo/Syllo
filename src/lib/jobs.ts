import "server-only";

import { inngest } from "@/inngest/client";
import { runLecturePipeline } from "@/lib/pipeline";
import { generateLectureQuiz } from "@/lib/quiz";
import { getServerEnv } from "@/lib/server-env";
import { generateLectureFlashcards } from "@/lib/study";

export type LectureProcessingStage = "transcribe" | "generate_notes";

const INTERNAL_LECTURE_PROCESSING_PATH = "/api/internal/lectures/process";

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

export async function enqueueLectureProcessing(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY) {
    await inngest.send({
      name: "lecture/process.requested",
      data: { lectureId },
    });
    return;
  }

  if (await enqueueLectureProcessingStage({ lectureId, stage: "transcribe" })) {
    return;
  }

  await runLecturePipeline({ lectureId }).catch(() => {
    // Errors are persisted on the lecture row by the pipeline.
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

  void generateLectureFlashcards({ lectureId }).catch((error) => {
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

  void generateLectureQuiz({ lectureId }).catch((error) => {
    console.error("Lecture quiz generation failed", { lectureId, error });
  });
}
