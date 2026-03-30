import { HomeDashboard } from "@/components/home-dashboard";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { listLecturesForUser } from "@/lib/lectures";

type SearchParams = Promise<{
  mode?: string;
}>;

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const appState = await getViewerAppState();
  const user = appState?.user ?? (await requireUser());
  const lectures = await listLecturesForUser(user.id);
  await searchParams;

  return (
    <HomeDashboard
      lectures={lectures}
      userId={user.id}
      canCreateNotes={Boolean(appState?.onboardingComplete && appState?.hasPaidAccess)}
    />
  );
}
