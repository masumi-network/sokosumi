import { connection } from "next/server";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import type { Notice } from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";

import { NoticeDialogHydrator } from "./shell-hydrators.client";

/**
 * Pending notices hydration — streamed separately from the
 * private-cached sidebar chrome (`Suspense fallback={null}`).
 * Must not private-cache: non-chrome data.
 */
export default async function AppShellOverlays() {
  // Defer before Core so Cache Components PPR probing does not soft-reject
  // dynamic APIs while filling this Suspense hole (#3617).
  await connection();
  const pendingNoticesResult = await getPendingNoticesAction();
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
    <NoticeDialogHydrator
      announcementNotices={announcementNotices}
      legalNotices={legalNotices}
    />
  );
}
