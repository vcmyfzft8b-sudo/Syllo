import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/auth-page-shell";
import { getOptionalUser } from "@/lib/auth";

type SearchParams = Promise<{
  next?: string;
  email?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await getOptionalUser();
  const params = await searchParams;
  const next = params?.next ?? "/app";
  const email = params?.email;

  if (user) {
    redirect(next);
  }

  return <AuthPageShell mode="login" next={next} prefilledEmail={email} />;
}
