import { after, NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { generateLectureFlashcards } from "@/lib/study";
import { getServerEnv } from "@/lib/server-env";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
});

export const maxDuration = 300;

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
    route: "api:internal:lectures:study:post",
    rules: rateLimitPresets.internal,
  });

  if (limited) {
    return limited;
  }

  const requestSecret = getSecretFromRequest(request);

  if (!env.INTERNAL_JOB_SECRET || requestSecret !== env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  after(async () => {
    try {
      await generateLectureFlashcards({
        lectureId: parsed.data.lectureId,
      });
    } catch (error) {
      console.error("Study generation failed", {
        lectureId: parsed.data.lectureId,
        error,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
