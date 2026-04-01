import { after, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { generateLectureQuiz } from "@/lib/quiz";
import { getServerEnv } from "@/lib/server-env";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
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

export async function POST(request: Request) {
  const env = getServerEnv();
  const limited = await enforceRateLimit({
    request,
    route: "api:internal:lectures:quiz:post",
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
      await generateLectureQuiz({
        lectureId: parsed.data.lectureId,
      });
    } catch (error) {
      console.error("Quiz generation failed", {
        lectureId: parsed.data.lectureId,
        error,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
