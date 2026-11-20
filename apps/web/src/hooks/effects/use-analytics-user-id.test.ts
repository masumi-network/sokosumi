import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAnalyticsUserId } from "./use-analytics-user-id";

describe("useAnalyticsUserId", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("skips initial null, pushes when a user signs in, ignores duplicate rerenders, and clears on logout", () => {
    const { rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useAnalyticsUserId(userId),
      { initialProps: { userId: null as string | null } },
    );

    expect(window.dataLayer).toEqual([]);

    rerender({ userId: "user-1" });
    expect(window.dataLayer).toEqual([
      { event: "set_user_id", user_id: "user-1" },
    ]);

    // Same user id does not push again
    rerender({ userId: "user-1" });
    expect(window.dataLayer).toHaveLength(1);

    // Logout clears user_id back to null
    rerender({ userId: null });
    expect(window.dataLayer).toEqual([
      { event: "set_user_id", user_id: "user-1" },
      { event: "set_user_id", user_id: null },
    ]);
  });

  it("initializes window.dataLayer when absent and pushes immediately for a signed-in user", () => {
    delete window.dataLayer;

    renderHook(() => useAnalyticsUserId("user-42"));

    expect(window.dataLayer).toEqual([
      { event: "set_user_id", user_id: "user-42" },
    ]);
  });
});
