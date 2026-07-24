"use client";

import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { AccountNotice } from "@/app/components/account-notice-state";

interface AccountNoticeContextValue {
  notice: AccountNotice | null;
  sessionId: string;
}

const AccountNoticeContext = createContext<AccountNoticeContextValue | null>(
  null,
);
const AccountNoticeHydrationContext = createContext<
  ((notice: AccountNotice | null) => void) | null
>(null);

interface AccountNoticeProviderProps {
  notice: AccountNotice | null;
  sessionId: string;
  children: React.ReactNode;
}

export function AccountNoticeProvider({
  notice: initialNotice,
  sessionId,
  children,
}: AccountNoticeProviderProps) {
  const [notice, setNotice] = useState<AccountNotice | null>(initialNotice);

  useEffect(() => {
    setNotice(initialNotice);
  }, [initialNotice]);

  const hydrateAccountNotice = useCallback(
    (nextNotice: AccountNotice | null) => {
      setNotice(nextNotice);
    },
    [],
  );

  const value = useMemo(() => ({ notice, sessionId }), [notice, sessionId]);

  return (
    <AccountNoticeHydrationContext.Provider value={hydrateAccountNotice}>
      <AccountNoticeContext value={value}>{children}</AccountNoticeContext>
    </AccountNoticeHydrationContext.Provider>
  );
}

export function useAccountNoticeHydration(): (
  notice: AccountNotice | null,
) => void {
  const hydrateAccountNotice = useContext(AccountNoticeHydrationContext);

  if (!hydrateAccountNotice) {
    throw new Error(
      "useAccountNoticeHydration must be used within an AccountNoticeProvider",
    );
  }

  return hydrateAccountNotice;
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
