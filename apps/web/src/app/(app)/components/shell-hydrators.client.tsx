"use client";

import { useEffect } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import type { AccountNotice } from "@/app/components/account-notice-state";
import { useNoticeDialogHydration } from "@/app/components/notice-dialog-context";
import { useAccountNoticeHydration } from "@/contexts/account-notice-provider";
import { useCoworkersHydration } from "@/contexts/coworkers-context";
import type { Notice } from "@/lib/clients/generated/core";

interface AccountNoticeHydratorProps {
  accountNotice: AccountNotice | null;
}

/**
 * Hydrates account notice independently so coworkers streaming must not wipe it.
 */
export function AccountNoticeHydrator({
  accountNotice,
}: AccountNoticeHydratorProps) {
  const hydrateAccountNotice = useAccountNoticeHydration();

  useEffect(() => {
    hydrateAccountNotice(accountNotice);
  }, [accountNotice, hydrateAccountNotice]);

  return null;
}

interface CoworkersHydratorProps {
  coworkers: Coworker[];
}

/**
 * Hydrates coworkers independently so account-notice private-cache stream
 * is unaffected when overlays resolve.
 */
export function CoworkersHydrator({ coworkers }: CoworkersHydratorProps) {
  const hydrateCoworkers = useCoworkersHydration();

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
