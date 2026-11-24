"use client";

import type { Notice } from "@sokosumi/core-client";
import { useEffect } from "react";
import { useNoticeDialogHydration } from "@/app/components/notice-dialog-context";

interface UseNoticeDialogHydrateNotices {
  announcementNotices: Notice[];
  legalNotices: Notice[];
}

/**
 * Hydrates `NoticeDialogProvider` with server-rendered announcement and legal
 * notices.
 */
export function useNoticeDialogHydrate({
  announcementNotices,
  legalNotices,
}: UseNoticeDialogHydrateNotices): void {
  const hydrateNotices = useNoticeDialogHydration();

  useEffect(() => {
    hydrateNotices({ announcementNotices, legalNotices });
  }, [announcementNotices, hydrateNotices, legalNotices]);
}
