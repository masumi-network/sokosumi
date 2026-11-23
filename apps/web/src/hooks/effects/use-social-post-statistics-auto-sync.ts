"use client";

import { type RefObject, useEffect } from "react";

interface AutoSyncAccount {
  id: string;
  status: string;
  sync?: { mayAutoRequest?: boolean } | null;
}

interface UseSocialPostStatisticsAutoSyncOptions<
  TAccount extends AutoSyncAccount,
> {
  accounts: readonly TAccount[];
  autoRequestKey: string;
  autoRequestedIdsRef: RefObject<Set<string>>;
  enqueueRefresh: (
    targets: TAccount[],
    options: { silent: boolean },
  ) => Promise<void> | void;
  isSuccess: boolean;
}

/**
 * Automatically enqueues a silent statistics refresh for stale active accounts
 * once the statistics query succeeds.
 */
export function useSocialPostStatisticsAutoSync<
  TAccount extends AutoSyncAccount,
>({
  accounts,
  autoRequestKey,
  autoRequestedIdsRef,
  enqueueRefresh,
  isSuccess,
}: UseSocialPostStatisticsAutoSyncOptions<TAccount>): void {
  useEffect(() => {
    if (!isSuccess) return;
    for (const account of accounts) {
      if (!account.sync?.mayAutoRequest)
        autoRequestedIdsRef.current.delete(account.id);
    }
    const stale = accounts.filter(
      (account) =>
        account.status === "active" &&
        account.sync?.mayAutoRequest &&
        !autoRequestedIdsRef.current.has(account.id),
    );
    if (stale.length === 0) return;
    for (const account of stale) autoRequestedIdsRef.current.add(account.id);
    void enqueueRefresh(stale, { silent: true });
  }, [autoRequestKey, isSuccess]);
}
