import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import {
  processLectureFunction,
  processLectureQuizFunction,
  processLectureStudyFunction,
} from "@/inngest/functions";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processLectureFunction, processLectureStudyFunction, processLectureQuizFunction],
});
