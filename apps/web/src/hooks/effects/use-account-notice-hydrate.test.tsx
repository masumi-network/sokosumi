import { act, render, renderHook } from "@testing-library/react";
import { Activity, type ReactNode, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import type { AccountNotice } from "@/app/components/account-notice-state";
import {
  AccountNoticeProvider,
  useAccountNotice,
  useAccountNoticeHydration,
} from "@/contexts/account-notice-provider";
import { useAccountNoticeHydrate } from "./use-account-notice-hydrate";

const VERIFY_NOTICE: AccountNotice = {
  email: "alice@example.com",
  tone: "warning",
  type: "emailVerification",
};

const UPDATED_NOTICE: AccountNotice = {
  email: "bob@example.com",
  tone: "warning",
  type: "emailVerification",
};

describe("useAccountNoticeHydrate", () => {
  it("hydrates the notice in passive effect phase and updates when the notice reference changes", () => {
    const layoutObserved: Array<AccountNotice | null> = [];
    let currentNotice: AccountNotice | null = null;
    let manualHydrate!: (notice: AccountNotice | null) => void;

    function Probe({
      notice,
      tick: _tick,
    }: {
      notice: AccountNotice | null;
      tick?: number;
    }) {
      useAccountNoticeHydrate(notice);
      const { notice: providerNotice } = useAccountNotice();
      manualHydrate = useAccountNoticeHydration();
      currentNotice = providerNotice;
      useLayoutEffect(() => {
        layoutObserved.push(providerNotice);
      }, []);
      return null;
    }

    const { rerender } = render(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Probe notice={VERIFY_NOTICE} tick={1} />
      </AccountNoticeProvider>,
    );

    // Passive effect runs after mount layout effects.
    expect(layoutObserved).toEqual([null]);
    expect(currentNotice).toEqual(VERIFY_NOTICE);

    // Unrelated rerender with the same notice reference does not re-hydrate over a manual update.
    act(() => {
      manualHydrate(UPDATED_NOTICE);
    });
    expect(currentNotice).toEqual(UPDATED_NOTICE);

    rerender(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Probe notice={VERIFY_NOTICE} tick={2} />
      </AccountNoticeProvider>,
    );
    expect(currentNotice).toEqual(UPDATED_NOTICE);

    // Passing a new notice value (including null) hydrates the provider again.
    rerender(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Probe notice={null} tick={3} />
      </AccountNoticeProvider>,
    );
    expect(currentNotice).toBeNull();
  });

  it("re-hydrates on Activity reveal", () => {
    let currentNotice: AccountNotice | null = null;
    let manualHydrate!: (notice: AccountNotice | null) => void;

    function Observer() {
      currentNotice = useAccountNotice().notice;
      manualHydrate = useAccountNoticeHydration();
      return null;
    }

    function Hydrator({ notice }: { notice: AccountNotice | null }) {
      useAccountNoticeHydrate(notice);
      return null;
    }

    const { rerender } = render(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Observer />
        <Activity mode="visible">
          <Hydrator notice={VERIFY_NOTICE} />
        </Activity>
      </AccountNoticeProvider>,
    );
    expect(currentNotice).toEqual(VERIFY_NOTICE);

    rerender(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Observer />
        <Activity mode="hidden">
          <Hydrator notice={VERIFY_NOTICE} />
        </Activity>
      </AccountNoticeProvider>,
    );
    act(() => {
      manualHydrate(null);
    });
    expect(currentNotice).toBeNull();

    rerender(
      <AccountNoticeProvider notice={null} sessionId="session-1">
        <Observer />
        <Activity mode="visible">
          <Hydrator notice={VERIFY_NOTICE} />
        </Activity>
      </AccountNoticeProvider>,
    );
    expect(currentNotice).toEqual(VERIFY_NOTICE);
  });

  it("throws when used outside AccountNoticeProvider", () => {
    expect(() =>
      renderHook(() => useAccountNoticeHydrate(VERIFY_NOTICE), {
        wrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
      }),
    ).toThrow(
      "useAccountNoticeHydration must be used within an AccountNoticeProvider",
    );
  });
});
