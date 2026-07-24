"use client";

import { useEffect } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import type { AccountNotice } from "@/app/components/account-notice-state";
import { useNoticeDialogHydration } from "@/app/components/notice-dialog-context";
import { useAccountNoticeHydration } from "@/contexts/account-notice-provider";
import { useCoworkersHydration } from "@/contexts/coworkers-context";
import type { Notice } from "@/lib/clients/generated/core";

interface ShellHydratorsProps {
  accountNotice: AccountNotice | null;
  coworkers: Coworker[];
}

export function ShellHydrators({
  accountNotice,
  coworkers,
}: ShellHydratorsProps) {
  const hydrateAccountNotice = useAccountNoticeHydration();
  const hydrateCoworkers = useCoworkersHydration();

  useEffect(() => {
    hydrateAccountNotice(accountNotice);
  }, [accountNotice, hydrateAccountNotice]);

  useEffect(() => {
    hydrateCoworkers(coworkers);
  }, [coworkers, hydrateCoworkers]);

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
