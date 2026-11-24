"use client";

import { useEffect } from "react";
import type { AccountNotice } from "@/app/components/account-notice-state";
import { useAccountNoticeHydration } from "@/contexts/account-notice-provider";

/**
 * Hydrates `AccountNoticeProvider` with the server-rendered account notice.
 */
export function useAccountNoticeHydrate(
  accountNotice: AccountNotice | null,
): void {
  const hydrateAccountNotice = useAccountNoticeHydration();

  useEffect(() => {
    hydrateAccountNotice(accountNotice);
  }, [accountNotice, hydrateAccountNotice]);
}
