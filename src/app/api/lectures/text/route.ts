import { NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { createLectureFromTextSource } from "@/lib/manual-lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { languageHintSchema, noteTextSchema, optionalLectureIdSchema } from "@/lib/validation";

const CREATE_TEXT_LECTURE_MAX_BYTES = 256 * 1024;

const createTextLectureSchema = z.object({
  lectureId: optionalLectureIdSchema,
  text: noteTextSchema,
  languageHint: languageHintSchema.default("sl"),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:text:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createTextLectureSchema, {
    maxBytes: CREATE_TEXT_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (!entitlement.hasPaidAccess && parsed.data.lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
      "trial_exhausted",
    );
  }

  try {
    if (parsed.data.lectureId) {
      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", parsed.data.lectureId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lectureError) {
        throw new Error(lectureError.message);
      }

      if (!lecture) {
        return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
      }
    }

    const lectureId = await createLectureFromTextSource({
      lectureId: parsed.data.lectureId,
      userId: user.id,
      sourceType: "text",
      text: parsed.data.text,
      languageHint: parsed.data.languageHint,
      modelMetadata: {
        importMode: "text",
      },
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Besedila ni bilo mogoče obdelati.",
      },
      { status: 500 },
    );
  }
}
