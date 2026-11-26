"use client";

import type { Notice } from "@sokosumi/core-client";
import type { AccountNotice } from "@/app/components/account-notice-state";
import { useAccountNoticeHydrate } from "@/hooks/effects/use-account-notice-hydrate";
import { useNoticeDialogHydrate } from "@/hooks/effects/use-notice-dialog-hydrate";

interface AccountNoticeHydratorProps {
  accountNotice: AccountNotice | null;
}

export function AccountNoticeHydrator({
  accountNotice,
}: AccountNoticeHydratorProps) {
  useAccountNoticeHydrate(accountNotice);

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
  useNoticeDialogHydrate({ announcementNotices, legalNotices });

  return null;
}
