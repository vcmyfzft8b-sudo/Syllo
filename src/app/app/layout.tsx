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

  return (
    <AppShell canCreateNotes={Boolean(appState?.onboardingComplete && appState?.hasPaidAccess)}>
      {children}
    </AppShell>
  );
}
