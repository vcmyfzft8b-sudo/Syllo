import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  describePracticeTestError,
  submitPracticeTestAttempt,
} from "@/lib/practice-test";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSanitizedStringSchema } from "@/lib/validation";

const paramsSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        answerId: z.string().uuid(),
        typedAnswer: createSanitizedStringSchema({
          maxLength: 12000,
          multiline: true,
          trim: true,
        }).or(z.literal("")),
        declaredUnknown: z.boolean(),
        photoPath: z.string().min(3).max(512).nullable(),
        photoMimeType: z.string().min(3).max(120).nullable(),
      }),
    )
    .min(1)
    .max(20),
});

const MAX_SUBMIT_BYTES = 256 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:submit:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid params." }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, submitSchema, {
    maxBytes: MAX_SUBMIT_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const lecture = await ensureUserOwnsLecture({
    lectureId: parsedParams.data.id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await submitPracticeTestAttempt({
      lectureId: parsedParams.data.id,
      userId: user.id,
      attemptId: parsedParams.data.attemptId,
      answers: parsed.data.answers,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: describePracticeTestError(error) },
      { status: 400 },
    );
  }
}
