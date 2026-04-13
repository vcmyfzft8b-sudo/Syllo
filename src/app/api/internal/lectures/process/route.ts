import { after, NextResponse } from "next/server";
import { z } from "zod";

import type { LectureProcessingStage } from "@/lib/jobs";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  transcribeLectureContent,
} from "@/lib/pipeline";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/server-env";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
  stage: z.enum(["transcribe", "generate_notes"]),
});

export const maxDuration = 300;
const INTERNAL_JOB_MAX_BYTES = 8 * 1024;

function getSecretFromRequest(request: Request) {
  const headerSecret = request.headers.get("x-internal-job-secret");

  if (headerSecret && headerSecret.length > 0) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

async function runLectureStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  if (params.stage === "transcribe") {
    await transcribeLectureContent({
      lectureId: params.lectureId,
    });

    await generateLectureNotesFromStoredTranscript({
      lectureId: params.lectureId,
    });

    return;
  }

  await generateLectureNotesFromStoredTranscript({
    lectureId: params.lectureId,
  });
}

export async function POST(request: Request) {
  const env = getServerEnv();
  const limited = await enforceRateLimit({
    request,
    route: "api:internal:lectures:process:post",
    rules: rateLimitPresets.internal,
  });

  if (limited) {
    return limited;
  }

  const requestSecret = getSecretFromRequest(request);

  if (!env.INTERNAL_JOB_SECRET || requestSecret !== env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const parsed = await parseJsonRequest(request, requestSchema, {
    maxBytes: INTERNAL_JOB_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  after(async () => {
    try {
      await runLectureStage(parsed.data);
    } catch (error) {
      await markLecturePipelineFailed({
        lectureId: parsed.data.lectureId,
        error,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
