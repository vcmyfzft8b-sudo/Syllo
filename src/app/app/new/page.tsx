import { redirect } from "next/navigation";

type SearchParams = Promise<{
  mode?: string;
}>;

export default async function NewLecturePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedMode =
    resolvedSearchParams.mode === "upload" ||
    resolvedSearchParams.mode === "record" ||
    resolvedSearchParams.mode === "text" ||
    resolvedSearchParams.mode === "link"
      ? resolvedSearchParams.mode
      : "record";

  redirect(`/app?mode=${requestedMode}`);
}
