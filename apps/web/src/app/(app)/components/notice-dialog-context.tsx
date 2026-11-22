"use client";

import type { Notice } from "@sokosumi/core-client";
import { NoticeKind } from "@sokosumi/core-client";
import { createContext, useContext, useMemo, useState } from "react";
import { useDeferredPromise } from "@/hooks/use-deferred-promise";
import {
  acknowledgeNoticeAction,
  getPendingNoticesAction,
} from "@/lib/actions/notice/action";

import { NoticeDialog } from "./notice-dialog";

export interface PendingNoticeGroups {
  legalNotices: Notice[];
  announcementNotices: Notice[];
}

const EMPTY_PENDING_NOTICES: PendingNoticeGroups = {
  legalNotices: [],
  announcementNotices: [],
};

interface NoticeDialogContextValue {
  openNotice: (notice: Notice) => void;
  /** Hides an announcement for good, as if it had been read. */
  dismissNotice: (notice: Notice) => void;
  announcementNotices: Notice[];
}

const NoticeDialogContext = createContext<NoticeDialogContextValue | null>(
  null,
);

interface NoticeDialogProviderProps {
  children: React.ReactNode;
  legalNotices: Notice[];
  announcementNotices: Notice[];
  pendingNoticesPromise?: Promise<PendingNoticeGroups>;
}

export function NoticeDialogProvider({
  children,
  legalNotices: initialLegalNotices,
  announcementNotices: initialAnnouncementNotices,
  pendingNoticesPromise,
}: NoticeDialogProviderProps) {
  const hydratedNotices = useDeferredPromise(
    pendingNoticesPromise,
    EMPTY_PENDING_NOTICES,
  );
  const [overrideNotices, setOverrideNotices] =
    useState<PendingNoticeGroups | null>(null);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [noticeToShow, setNoticeToShow] = useState<Notice | null>(null);

  const legalNotices =
    overrideNotices?.legalNotices ??
    hydratedNotices?.legalNotices ??
    initialLegalNotices;
  const rawAnnouncementNotices =
    overrideNotices?.announcementNotices ??
    hydratedNotices?.announcementNotices ??
    initialAnnouncementNotices;
  const announcementNotices = useMemo(
    () =>
      dismissedIds.size === 0
        ? rawAnnouncementNotices
        : rawAnnouncementNotices.filter(
            (notice) => !dismissedIds.has(notice.id),
          ),
    [rawAnnouncementNotices, dismissedIds],
  );

  const value = useMemo<NoticeDialogContextValue>(
    () => ({
      openNotice: (notice) => setNoticeToShow(notice),
      dismissNotice: (notice) => {
        setDismissedIds((current) => {
          if (current.has(notice.id)) return current;
          const next = new Set(current);
          next.add(notice.id);
          return next;
        });
        void acknowledgeNoticeAction(notice.id);
      },
      announcementNotices,
    }),
    [announcementNotices],
  );

  function handleNoticeClose() {
    setNoticeToShow(null);
  }

  async function handleNoticeAcknowledged() {
    const result = await getPendingNoticesAction();
    if (result.ok) {
      const pendingNotices = result.value;
      setDismissedIds(new Set());
      setOverrideNotices({
        legalNotices: pendingNotices.filter(
          (notice) => notice.kind === NoticeKind.LEGAL_TERMS,
        ),
        announcementNotices: pendingNotices.filter(
          (notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
        ),
      });
    }
  }

  return (
    <NoticeDialogContext.Provider value={value}>
      {children}
      <NoticeDialog
        pendingNotices={legalNotices}
        noticeToShow={noticeToShow}
        onNoticeClose={handleNoticeClose}
        onNoticeAcknowledged={handleNoticeAcknowledged}
      />
    </NoticeDialogContext.Provider>
  );
}

export function useNoticeDialog() {
  const context = useContext(NoticeDialogContext);

  if (!context) {
    throw new Error(
      "useNoticeDialog must be used within NoticeDialogProvider.",
    );
  }

  return context;
}
