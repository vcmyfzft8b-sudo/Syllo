import { NextResponse } from "next/server";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES, MAX_SCAN_IMAGE_COUNT } from "@/lib/constants";
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
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  if (!entitlement.canCreateNotes) {
    return createBillingRequiredResponse(
      "Tvoj brezplačni preizkus je porabljen. Nadgradi za novo gradivo.",
      "trial_exhausted",
    );
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
    const fileCandidates = formData
      .getAll("files")
      .filter((candidate): candidate is File => candidate instanceof File);
    const legacyFileCandidate = formData.get("file");
    const files =
      fileCandidates.length > 0
        ? fileCandidates
        : legacyFileCandidate instanceof File
          ? [legacyFileCandidate]
          : [];

    if (files.length === 0) {
      return NextResponse.json({ error: "Najprej dodaj fotografijo za skeniranje." }, { status: 400 });
    }

    if (files.length > MAX_SCAN_IMAGE_COUNT) {
      return NextResponse.json(
        { error: `Dosegel si največ ${MAX_SCAN_IMAGE_COUNT} fotografij naenkrat.` },
        { status: 400 },
      );
    }

    const extractedTexts: string[] = [];
    const extractedFileNames: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Za skeniranje uporabi slikovno datoteko." },
          { status: 400 },
        );
      }

      if (file.size > MAX_SCAN_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Slika za skeniranje je prevelika. Omejitev je 8 MB." },
          { status: 400 },
        );
      }

      const extracted = await extractTextFromImage(file);

      if (!extracted.text.trim()) {
        return NextResponse.json(
          {
            error:
              files.length === 1
                ? "Na fotografiji ni bilo mogoče najti berljivega besedila."
                : `Na fotografiji "${file.name}" ni bilo mogoče najti berljivega besedila.`,
          },
          { status: 400 },
        );
      }

      extractedTexts.push(extracted.text.trim());
      extractedFileNames.push(file.name);
    }

    return NextResponse.json({
      text: extractedTexts.join("\n\n"),
      fileNames: extractedFileNames,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Fotografije ni bilo mogoče skenirati.",
      },
      { status: 500 },
    );
  }
}
