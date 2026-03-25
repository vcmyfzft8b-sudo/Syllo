import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
  enqueueLectureProcessingStage,
  type LectureProcessingStage,
} from "@/lib/jobs";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  transcribeLectureContent,
} from "@/lib/pipeline";
import { getServerEnv } from "@/lib/server-env";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
  stage: z.enum(["transcribe", "generate_notes"]),
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

async function runLectureStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  if (params.stage === "transcribe") {
    await transcribeLectureContent({
      lectureId: params.lectureId,
    });

    await enqueueLectureProcessingStage({
      lectureId: params.lectureId,
      stage: "generate_notes",
    });

    return;
  }

  await generateLectureNotesFromStoredTranscript({
    lectureId: params.lectureId,
  });
}

export async function POST(request: Request) {
  const env = getServerEnv();
  const requestSecret = getSecretFromRequest(request);

  if (!env.INTERNAL_JOB_SECRET || requestSecret !== env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.flatten(),
      },
      { status: 400 },
    );
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
