import { describe, expect, it, vi } from "vitest";

import {
  getMyPreferencesQueryKey,
  getMyPreferencesQueryOptions,
} from "@/queries/preferences";

vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: {
    getMyPreferences: vi.fn(),
  },
}));

describe("getMyPreferencesQueryKey", () => {
  /**
   * The browser query client is a module singleton, so the cache outlives a
   * sign-out. Two readers on one browser must not share an entry.
   */
  it("gives two readers two keys", () => {
    expect(getMyPreferencesQueryKey("user-1")).not.toEqual(
      getMyPreferencesQueryKey("user-2"),
    );
  });

  it("keys a signed-out read apart from every reader", () => {
    expect(getMyPreferencesQueryKey(undefined)).toEqual(["preferences", null]);
  });
});

describe("getMyPreferencesQueryOptions", () => {
  it("reads for a signed-in reader", () => {
    expect(getMyPreferencesQueryOptions("user-1").enabled).toBe(true);
  });

  /** Without a session the read is a guaranteed 401. */
  it("reads nothing without a session", () => {
    expect(getMyPreferencesQueryOptions(undefined).enabled).toBe(false);
  });
});
