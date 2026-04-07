import { notFound } from "next/navigation";

import { LectureWorkspace } from "@/components/lecture-workspace";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import { getLectureDetailForUser } from "@/lib/lectures";
import { routeIdParamSchema } from "@/lib/validation";

export default async function LecturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const parsedParams = routeIdParamSchema.safeParse(await params);

  if (!parsedParams.success) {
    notFound();
  }

  const { id } = parsedParams.data;
  const appState = await getViewerAppState();
  const detail = await getLectureDetailForUser({
    lectureId: id,
    userId: user.id,
  });

  if (!detail) {
    notFound();
  }

  return (
    <LectureWorkspace
      initialDetail={detail}
      hasPaidAccess={Boolean(appState?.hasPaidAccess)}
      trialLectureId={appState?.trialLectureId ?? null}
      initialTrialChatMessagesRemaining={appState?.trialChatMessagesRemaining ?? 5}
    />
  );
}
