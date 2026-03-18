import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/auth-page-shell";
import { getOptionalUser } from "@/lib/auth";

type SearchParams = Promise<{
  next?: string;
}>;

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await getOptionalUser();
  const params = await searchParams;
  const next = params?.next ?? "/app";

  if (user) {
    redirect(next);
  }

  return <AuthPageShell mode="signup" next={next} />;
}
