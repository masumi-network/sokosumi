"use client";

import { useEffect } from "react";

import type { AccountNotice } from "@/app/components/account-notice-state";
import { useNoticeDialogHydration } from "@/app/components/notice-dialog-context";
import { useAccountNoticeHydration } from "@/contexts/account-notice-provider";
import type { Notice } from "@/lib/clients/generated/core";

interface AccountNoticeHydratorProps {
  accountNotice: AccountNotice | null;
}

export function AccountNoticeHydrator({
  accountNotice,
}: AccountNoticeHydratorProps) {
  const hydrateAccountNotice = useAccountNoticeHydration();

  useEffect(() => {
    hydrateAccountNotice(accountNotice);
  }, [accountNotice, hydrateAccountNotice]);

  return null;
}

interface NoticeDialogHydratorProps {
  announcementNotices: Notice[];
  legalNotices: Notice[];
}

export function NoticeDialogHydrator({
  announcementNotices,
  legalNotices,
}: NoticeDialogHydratorProps) {
  const hydrateNotices = useNoticeDialogHydration();

  useEffect(() => {
    hydrateNotices({ announcementNotices, legalNotices });
  }, [announcementNotices, hydrateNotices, legalNotices]);

  return null;
}
