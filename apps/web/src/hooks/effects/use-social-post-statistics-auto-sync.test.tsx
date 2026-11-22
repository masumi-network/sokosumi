import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSocialPostStatisticsAutoSync } from "./use-social-post-statistics-auto-sync";

interface Account {
  id: string;
  status: string;
  sync?: { mayAutoRequest?: boolean } | null;
}

describe("useSocialPostStatisticsAutoSync", () => {
  it("enqueues silent refresh once per stale active account and clears tracking once mayAutoRequest turns false", () => {
    const autoRequestedIdsRef = { current: new Set<string>() };
    const enqueueRefresh = vi.fn(async () => {});
    const initialAccounts: Account[] = [
      { id: "acc-1", status: "active", sync: { mayAutoRequest: true } },
      { id: "acc-2", status: "pending", sync: { mayAutoRequest: true } },
    ];

    const { rerender } = renderHook(
      ({
        accounts,
        autoRequestKey,
        isSuccess,
      }: {
        accounts: Account[];
        autoRequestKey: string;
        isSuccess: boolean;
      }) =>
        useSocialPostStatisticsAutoSync({
          accounts,
          autoRequestKey,
          autoRequestedIdsRef,
          enqueueRefresh,
          isSuccess,
        }),
      {
        initialProps: {
          accounts: initialAccounts,
          autoRequestKey: "acc-1,acc-2",
          isSuccess: false,
        },
      },
    );

    expect(enqueueRefresh).not.toHaveBeenCalled();

    rerender({
      accounts: initialAccounts,
      autoRequestKey: "acc-1,acc-2",
      isSuccess: true,
    });
    expect(enqueueRefresh).toHaveBeenCalledTimes(1);
    expect(enqueueRefresh).toHaveBeenCalledWith([initialAccounts[0]], {
      silent: true,
    });

    rerender({
      accounts: [
        { id: "acc-1", status: "active", sync: { mayAutoRequest: false } },
      ],
      autoRequestKey: "",
      isSuccess: true,
    });
    expect(autoRequestedIdsRef.current.has("acc-1")).toBe(false);
    expect(enqueueRefresh).toHaveBeenCalledTimes(1);

    const refreshed: Account[] = [
      { id: "acc-1", status: "active", sync: { mayAutoRequest: true } },
    ];
    rerender({
      accounts: refreshed,
      autoRequestKey: "acc-1",
      isSuccess: true,
    });
    expect(enqueueRefresh).toHaveBeenCalledTimes(2);
    expect(enqueueRefresh).toHaveBeenLastCalledWith(refreshed, {
      silent: true,
    });
  });
});
