import { inngest } from "@/inngest/client";
import { runLecturePipeline } from "@/lib/pipeline";
import { generateLectureQuiz } from "@/lib/quiz";
import { generateLectureFlashcards } from "@/lib/study";

export const processLectureFunction = inngest.createFunction(
  { id: "process-lecture" },
  { event: "lecture/process.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture", async () => {
      await runLecturePipeline({
        lectureId: event.data.lectureId,
      });
    });
  },
);

export const processLectureStudyFunction = inngest.createFunction(
  { id: "process-lecture-study" },
  { event: "lecture/study.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-study", async () => {
      try {
        await generateLectureFlashcards({
          lectureId: event.data.lectureId,
        });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown flashcard generation error.",
        };
      }

      return { ok: true };
    });
  },
);

export const processLectureQuizFunction = inngest.createFunction(
  { id: "process-lecture-quiz" },
  { event: "lecture/quiz.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-quiz", async () => {
      try {
        await generateLectureQuiz({
          lectureId: event.data.lectureId,
        });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown quiz generation error.",
        };
      }

      return { ok: true };
    });
  },
);
