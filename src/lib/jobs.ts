import "server-only";

import { inngest } from "@/inngest/client";
import { runLecturePipeline } from "@/lib/pipeline";
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

  void runLecturePipeline({ lectureId })
    .then(async () => {
      await enqueueLectureStudyGeneration(lectureId);
    })
    .catch(() => {
      // Flashcards only generate after the note pipeline succeeds.
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

  void generateLectureFlashcards({ lectureId }).catch(() => {
    // Errors are persisted into lecture_study_assets for later inspection.
  });
}
