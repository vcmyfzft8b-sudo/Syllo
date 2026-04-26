import { NextResponse } from "next/server";

import { canUseLectureFeatures } from "@/lib/billing";
import { getLectureDetailForUser } from "@/lib/lectures";
import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  stripLeadingRedundantHeading,
} from "@/lib/note-tts-text";
import { getTtsUsageState, hasUnlimitedTtsUsage } from "@/lib/note-tts";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tts:status",
    rules: rateLimitPresets.ttsStatus,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "study");
  const hasUnlimitedUsage = hasUnlimitedTtsUsage(user.email);
  const usage = await getTtsUsageState({
    userId: user.id,
    hasPaidAccess: access.entitlement.hasPaidAccess,
    hasUnlimitedUsage,
  });
  const content = detail.artifact?.structured_notes_md
    ? stripLeadingRedundantHeading(detail.artifact.structured_notes_md, detail.lecture.title)
    : "";
  const document = content ? parseNoteTtsDocument(content) : null;
  const chunkCount = document ? buildNoteTtsChunks(document).length : 0;
  const available = access.allowed && detail.lecture.status === "ready" && Boolean(content) && chunkCount > 0;

  return NextResponse.json({
    available,
    reason: !access.allowed
      ? "subscription_required"
      : detail.lecture.status !== "ready" || !content
        ? "notes_not_ready"
        : chunkCount === 0
          ? "empty_notes"
          : null,
    tier: access.entitlement.hasPaidAccess ? "paid" : "free",
    limitSeconds: usage.limitSeconds,
    secondsUsed: usage.secondsUsed,
    remainingSeconds: usage.remainingSeconds,
    hasUnlimitedUsage,
    chunkCount,
    totalWords: document?.words.length ?? 0,
  });
}
