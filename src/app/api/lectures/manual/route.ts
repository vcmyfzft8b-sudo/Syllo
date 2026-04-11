import { NextResponse } from "next/server";
import { z } from "zod";

import {
  claimTrialLecture,
  createBillingRequiredResponse,
  getUserEntitlementState,
} from "@/lib/billing";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { languageHintSchema } from "@/lib/validation";

const CREATE_MANUAL_LECTURE_MAX_BYTES = 8 * 1024;

const createManualLectureSchema = z.object({
  sourceType: z.enum(["text", "pdf", "link"]),
  languageHint: languageHintSchema.default("sl"),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  if (!entitlement.canCreateNotes) {
    return createBillingRequiredResponse(
      "Tvoj brezplačni preizkus je porabljen. Nadgradi za novo gradivo.",
      "trial_exhausted",
    );
  }

  if (!entitlement.hasPaidAccess && entitlement.trialLectureId && entitlement.canResumeTrialLecture) {
    return NextResponse.json({
      lectureId: entitlement.trialLectureId,
    });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:manual:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createManualLectureSchema, {
    maxBytes: CREATE_MANUAL_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const { data: lecture, error } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: user.id,
        source_type: parsed.data.sourceType,
        access_tier: entitlement.hasPaidAccess ? "paid" : "trial",
        status: "uploading",
        language_hint: parsed.data.languageHint,
      } as never,
    )
    .select("id")
    .single();

  if (error || !lecture) {
    return NextResponse.json(
      { error: error?.message ?? "Zapiska ni bilo mogoče ustvariti." },
      { status: 500 },
    );
  }

  if (!entitlement.hasPaidAccess) {
    const createdLectureId = (lecture as { id: string }).id;
    const trialClaim = await claimTrialLecture(user.id, createdLectureId);

    if (!trialClaim.allowed) {
      await supabase
        .from("lectures")
        .delete()
        .eq("id", createdLectureId)
        .eq("user_id", user.id);

      return createBillingRequiredResponse(
        "Tvoj brezplačni preizkus je že porabljen. Nadgradi za novo gradivo.",
        "trial_exhausted",
      );
    }

    if (trialClaim.mode === "paid") {
      await supabase
        .from("lectures")
        .update({ access_tier: "paid" } as never)
        .eq("id", createdLectureId)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    lectureId: (lecture as { id: string }).id,
  });
}
