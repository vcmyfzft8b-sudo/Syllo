import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";

function canBrowseWithoutSubscription(pathname: string) {
  return (
    pathname === "/app" ||
    pathname === "/app/settings" ||
    pathname === "/app/start" ||
    pathname === "/app/support" ||
    pathname.startsWith("/app/support/")
  );
}

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
    appState &&
    appState.onboardingComplete &&
    !appState.hasPaidAccess &&
    !canBrowseWithoutSubscription(pathname)
  ) {
    redirect("/app/start");
  }

  if (appState?.onboardingComplete && appState.hasPaidAccess && pathname === "/app/start") {
    redirect("/app");
  }

  return (
    <AppShell
      canCreateNotes={Boolean(appState?.onboardingComplete && appState?.hasPaidAccess)}
      hideNavigation={pathname === "/app/start"}
    >
      {children}
    </AppShell>
  );
}
