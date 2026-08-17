import { connection } from "next/server";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import type { Notice } from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";
import { coworkerService } from "@/lib/services/coworker.service";

import {
  CoworkersHydrator,
  NoticeDialogHydrator,
} from "./shell-hydrators.client";

/**
 * Pending notices and coworkers hydration — streamed separately from the
 * private-cached sidebar chrome (`Suspense fallback={null}`).
 * Must not private-cache: non-chrome data.
 */
export default async function AppShellOverlays() {
  // Defer before Core so Cache Components PPR probing does not soft-reject
  // dynamic APIs while filling this Suspense hole (#3617).
  await connection();
  const [pendingNoticesResult, coworkersResult] = await Promise.all([
    getPendingNoticesAction(),
    coworkerService.listCoworkers().catch(() => []),
  ]);
  const coworkers = coworkersResult.map(mapDbCoworkerToChatCoworker);
  const pendingNotices = pendingNoticesResult.ok
    ? pendingNoticesResult.data
    : [];
  const legalNotices = pendingNotices.filter(
    (notice: Notice) => notice.kind === NoticeKind.LEGAL_TERMS,
  );
  const announcementNotices = pendingNotices.filter(
    (notice: Notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
  );

  return (
    <>
      <CoworkersHydrator coworkers={coworkers} />
      <NoticeDialogHydrator
        announcementNotices={announcementNotices}
        legalNotices={legalNotices}
      />
    </>
  );
}
