"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getPendingNoticesAction } from "@/lib/actions/notice";
import type { Notice } from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";

import { NoticeDialog } from "./notice-dialog";

interface NoticeDialogContextValue {
  openNotice: (notice: Notice) => void;
  announcementNotices: Notice[];
}

const NoticeDialogContext = createContext<NoticeDialogContextValue | null>(
  null,
);
const NoticeDialogHydrationContext = createContext<
  | ((notices: {
      announcementNotices: Notice[];
      legalNotices: Notice[];
    }) => void)
  | null
>(null);

interface NoticeDialogProviderProps {
  children: React.ReactNode;
  legalNotices: Notice[];
  announcementNotices: Notice[];
}

export function NoticeDialogProvider({
  children,
  legalNotices: initialLegalNotices,
  announcementNotices: initialAnnouncementNotices,
}: NoticeDialogProviderProps) {
  const [legalNotices, setLegalNotices] = useState(initialLegalNotices);
  const [announcementNotices, setAnnouncementNotices] = useState(
    initialAnnouncementNotices,
  );
  const [noticeToShow, setNoticeToShow] = useState<Notice | null>(null);

  useEffect(() => {
    setLegalNotices(initialLegalNotices);
  }, [initialLegalNotices]);

  useEffect(() => {
    setAnnouncementNotices(initialAnnouncementNotices);
  }, [initialAnnouncementNotices]);

  const hydrateNotices = useCallback(
    (notices: { announcementNotices: Notice[]; legalNotices: Notice[] }) => {
      setLegalNotices(notices.legalNotices);
      setAnnouncementNotices(notices.announcementNotices);
    },
    [],
  );

  const value = useMemo<NoticeDialogContextValue>(
    () => ({
      openNotice: (notice) => setNoticeToShow(notice),
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
      const pendingNotices = result.data;
      setLegalNotices(
        pendingNotices.filter(
          (notice) => notice.kind === NoticeKind.LEGAL_TERMS,
        ),
      );
      setAnnouncementNotices(
        pendingNotices.filter(
          (notice) => notice.kind === NoticeKind.ANNOUNCEMENT,
        ),
      );
    }
  }

  return (
    <NoticeDialogHydrationContext.Provider value={hydrateNotices}>
      <NoticeDialogContext.Provider value={value}>
        {children}
        <NoticeDialog
          pendingNotices={legalNotices}
          noticeToShow={noticeToShow}
          onNoticeClose={handleNoticeClose}
          onNoticeAcknowledged={handleNoticeAcknowledged}
        />
      </NoticeDialogContext.Provider>
    </NoticeDialogHydrationContext.Provider>
  );
}

export function useNoticeDialogHydration(): (notices: {
  announcementNotices: Notice[];
  legalNotices: Notice[];
}) => void {
  const hydrateNotices = useContext(NoticeDialogHydrationContext);

  if (!hydrateNotices) {
    throw new Error(
      "useNoticeDialogHydration must be used within a NoticeDialogProvider.",
    );
  }

  return hydrateNotices;
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
