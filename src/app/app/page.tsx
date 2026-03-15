import { HomeDashboard } from "@/components/home-dashboard";
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
  const user = await requireUser();
  const lectures = await listLecturesForUser(user.id);
  await searchParams;

  return (
    <HomeDashboard lectures={lectures} />
  );
}
