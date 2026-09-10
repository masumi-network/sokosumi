"use client";

import { useEffect } from "react";

import type { AccountNotice } from "@/app/components/account-notice-state";
import { useNoticeDialogHydration } from "@/app/components/notice-dialog-context";
import { useAccountNoticeHydration } from "@/contexts/account-notice-provider";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { Notice } from "@/lib/clients/generated/core";
import { expireRetiredOnboardingLocalStorage } from "@/lib/retired-onboarding-storage";

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

/** Drops unread SOK-799 localStorage left by the retired intro dialog. */
export function RetiredOnboardingStorageHydrator() {
  useMountEffect(() => {
    expireRetiredOnboardingLocalStorage();
  });

  return null;
}
