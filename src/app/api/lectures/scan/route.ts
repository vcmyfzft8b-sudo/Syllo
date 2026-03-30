import { NextResponse } from "next/server";

import { createBillingRequiredResponse, hasPaidAccessForUserId } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES } from "@/lib/constants";
import { extractTextFromImage } from "@/lib/manual-lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasPaidAccessForUserId(user.id))) {
    return createBillingRequiredResponse("Choose a plan before scanning study material.");
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:scan:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    const formData = await request.formData();
    const fileCandidate = formData.get("file");

    if (!(fileCandidate instanceof File)) {
      return NextResponse.json({ error: "Add a photo to scan first." }, { status: 400 });
    }

    if (!fileCandidate.type.startsWith("image/")) {
      return NextResponse.json({ error: "Use an image file for scanning." }, { status: 400 });
    }

    if (fileCandidate.size > MAX_SCAN_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "The scan image is too large. The limit is 8 MB." },
        { status: 400 },
      );
    }

    const extracted = await extractTextFromImage(fileCandidate);

    if (!extracted.text.trim()) {
      return NextResponse.json(
        { error: "No readable text was found in the photo." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      title: extracted.title,
      text: extracted.text,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "The photo could not be scanned.",
      },
      { status: 500 },
    );
  }
}
