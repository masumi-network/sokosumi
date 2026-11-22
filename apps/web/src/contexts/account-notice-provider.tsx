"use client";

import { createContext, use, useMemo } from "react";

import type { AccountNotice } from "@/app/components/account-notice-state";
import { useDeferredPromise } from "@/hooks/use-deferred-promise";

interface AccountNoticeContextValue {
  notice: AccountNotice | null;
  sessionId: string;
}

const AccountNoticeContext = createContext<AccountNoticeContextValue | null>(
  null,
);

interface AccountNoticeProviderProps {
  notice: AccountNotice | null;
  noticePromise?: Promise<AccountNotice | null>;
  sessionId: string;
  children: React.ReactNode;
}

export function AccountNoticeProvider({
  notice: initialNotice,
  noticePromise,
  sessionId,
  children,
}: AccountNoticeProviderProps) {
  const hydratedNotice = useDeferredPromise(noticePromise, null);
  const notice = hydratedNotice !== undefined ? hydratedNotice : initialNotice;

  const value = useMemo(() => ({ notice, sessionId }), [notice, sessionId]);

  return <AccountNoticeContext value={value}>{children}</AccountNoticeContext>;
}

export function useAccountNotice(): AccountNoticeContextValue {
  const context = use(AccountNoticeContext);

  if (!context) {
    throw new Error(
      "useAccountNotice must be used within an AccountNoticeProvider",
    );
  }

  return context;
}
