"use client";

import { createContext, use } from "react";

import type { AccountNotice } from "@/app/components/account-notice-state";

interface AccountNoticeContextValue {
  notice: AccountNotice | null;
  sessionId: string;
}

const AccountNoticeContext = createContext<AccountNoticeContextValue | null>(
  null,
);

interface AccountNoticeProviderProps {
  notice: AccountNotice | null;
  sessionId: string;
  children: React.ReactNode;
}

export function AccountNoticeProvider({
  notice,
  sessionId,
  children,
}: AccountNoticeProviderProps) {
  return (
    <AccountNoticeContext value={{ notice, sessionId }}>
      {children}
    </AccountNoticeContext>
  );
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
