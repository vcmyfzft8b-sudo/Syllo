import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const appState = await getViewerAppState();
  const pathname = (await headers()).get("x-pathname") ?? "/app";

  if (appState && !appState.onboardingComplete && pathname !== "/app/start") {
    redirect("/app/start");
  }

  if (
    appState?.onboardingComplete &&
    (appState.hasPaidAccess || appState.hasTrialLectureAvailable) &&
    pathname === "/app/start"
  ) {
    redirect("/app");
  }

  return (
    <AppShell
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      hasTrialLectureAvailable={Boolean(appState?.hasTrialLectureAvailable)}
    >
      {children}
    </AppShell>
  );
}
