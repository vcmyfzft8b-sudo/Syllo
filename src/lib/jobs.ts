import "server-only";

import { inngest } from "@/inngest/client";
import { runLecturePipeline } from "@/lib/pipeline";
import { generateLectureQuiz } from "@/lib/quiz";
import { getServerEnv } from "@/lib/server-env";
import { generateLectureFlashcards } from "@/lib/study";

export async function enqueueLectureProcessing(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "lecture/process.requested",
      data: { lectureId },
    });
    return;
  }

  void runLecturePipeline({ lectureId }).catch(() => {
    // Errors are persisted on the lecture row by the pipeline.
  });
}

export async function enqueueLectureStudyGeneration(lectureId: string) {
  const env = getServerEnv();

  if (env.INNGEST_EVENT_KEY) {
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

  if (env.INNGEST_EVENT_KEY) {
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
