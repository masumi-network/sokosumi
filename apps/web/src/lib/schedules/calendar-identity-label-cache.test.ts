import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheCalendarIdentityLabels,
  clearCalendarIdentityLabelCacheForWorkspace,
  getCachedCalendarIdentityLabel,
} from "./calendar-identity-label-cache";

describe("Calendar identity label cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
    clearCalendarIdentityLabelCacheForWorkspace("workspace_a");
    clearCalendarIdentityLabelCacheForWorkspace("workspace_b");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached labels for five minutes", () => {
    cacheCalendarIdentityLabels("workspace_a", [
      { ref: "user_1", state: "current_member", label: "Ada" },
      { ref: "user_2", state: "unknown" },
    ]);

    expect(getCachedCalendarIdentityLabel("workspace_a", "user_1")).toEqual({
      ref: "user_1",
      state: "current_member",
      label: "Ada",
    });
    expect(getCachedCalendarIdentityLabel("workspace_a", "user_2")).toEqual({
      ref: "user_2",
      state: "unknown",
    });

    vi.advanceTimersByTime(299_999);
    expect(getCachedCalendarIdentityLabel("workspace_a", "user_1")).toEqual(
      expect.objectContaining({ label: "Ada" }),
    );

    vi.advanceTimersByTime(1);
    expect(
      getCachedCalendarIdentityLabel("workspace_a", "user_1"),
    ).toBeUndefined();
  });

  it("keeps refs isolated by workspace", () => {
    cacheCalendarIdentityLabels("workspace_a", [
      { ref: "user_1", state: "current_member", label: "Ada" },
    ]);
    cacheCalendarIdentityLabels("workspace_b", [
      { ref: "user_1", state: "current_member", label: "Grace" },
    ]);

    expect(getCachedCalendarIdentityLabel("workspace_a", "user_1")?.label).toBe(
      "Ada",
    );
    expect(getCachedCalendarIdentityLabel("workspace_b", "user_1")?.label).toBe(
      "Grace",
    );
  });

  it("clears only the requested workspace", () => {
    cacheCalendarIdentityLabels("workspace_a", [
      { ref: "user_1", state: "former_member" },
    ]);
    cacheCalendarIdentityLabels("workspace_b", [
      { ref: "user_1", state: "current_member", label: "Grace" },
    ]);

    clearCalendarIdentityLabelCacheForWorkspace("workspace_a");

    expect(
      getCachedCalendarIdentityLabel("workspace_a", "user_1"),
    ).toBeUndefined();
    expect(getCachedCalendarIdentityLabel("workspace_b", "user_1")).toEqual({
      ref: "user_1",
      state: "current_member",
      label: "Grace",
    });
  });
});
