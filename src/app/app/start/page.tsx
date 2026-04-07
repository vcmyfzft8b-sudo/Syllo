import { redirect } from "next/navigation";

import { OnboardingPaywall } from "@/components/onboarding-paywall";
import { BILLING_PLANS, getViewerAppState } from "@/lib/billing";

export default async function AppStartPage() {
  const appState = await getViewerAppState();

  if (!appState) {
    redirect("/");
  }

  if (appState.onboardingComplete && (appState.hasPaidAccess || appState.hasTrialLectureAvailable)) {
    redirect("/app");
  }

  return (
    <main className="app-start-shell">
      <OnboardingPaywall
        profile={appState.profile}
        subscription={appState.subscription}
        onboardingComplete={appState.onboardingComplete}
        hasPaidAccess={appState.hasPaidAccess}
        plans={Object.values(BILLING_PLANS)}
      />
    </main>
  );
}
