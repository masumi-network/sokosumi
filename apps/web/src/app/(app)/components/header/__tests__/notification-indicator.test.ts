import { describe, expect, it } from "vitest";

import {
  formatUnreadBadgeCount,
  getNotificationIndicator,
  getNotificationIndicatorClassName,
} from "../notification-indicator";

describe("formatUnreadBadgeCount", () => {
  it("returns the raw count at or below the cap", () => {
    expect(formatUnreadBadgeCount(1)).toBe("1");
    expect(formatUnreadBadgeCount(9)).toBe("9");
  });

  it("caps counts above 9 as 9+", () => {
    expect(formatUnreadBadgeCount(10)).toBe("9+");
    expect(formatUnreadBadgeCount(100)).toBe("9+");
  });
});

describe("getNotificationIndicator", () => {
  it("returns null when there is no unread and no account notice", () => {
    expect(getNotificationIndicator(0, false)).toBeNull();
  });

  it("returns a primary count badge for unread without notice", () => {
    expect(getNotificationIndicator(3, false)).toEqual({
      kind: "count",
      value: "3",
      tone: "primary",
    });
  });

  it("caps unread counts on the badge value", () => {
    expect(getNotificationIndicator(12, false)).toEqual({
      kind: "count",
      value: "9+",
      tone: "primary",
    });
  });

  it("tints the count badge with the account notice tone", () => {
    expect(getNotificationIndicator(2, true, "warning")).toEqual({
      kind: "count",
      value: "2",
      tone: "warning",
    });
    expect(getNotificationIndicator(2, true, "destructive")).toEqual({
      kind: "count",
      value: "2",
      tone: "destructive",
    });
  });

  it("returns a tone-colored dot for notice-only state", () => {
    expect(getNotificationIndicator(0, true, "warning")).toEqual({
      kind: "dot",
      tone: "warning",
    });
    expect(getNotificationIndicator(0, true, "destructive")).toEqual({
      kind: "dot",
      tone: "destructive",
    });
  });

  it("defaults notice tone to warning when unspecified", () => {
    expect(getNotificationIndicator(0, true)).toEqual({
      kind: "dot",
      tone: "warning",
    });
  });

  it("defaults notice tone to warning on the count path when unspecified", () => {
    expect(getNotificationIndicator(2, true)).toEqual({
      kind: "count",
      value: "2",
      tone: "warning",
    });
  });
});

describe("getNotificationIndicatorClassName", () => {
  it("maps tones to semantic utility classes", () => {
    expect(getNotificationIndicatorClassName("primary")).toContain(
      "bg-primary",
    );
    expect(getNotificationIndicatorClassName("warning")).toContain(
      "bg-semantic-warning",
    );
    expect(getNotificationIndicatorClassName("destructive")).toContain(
      "bg-semantic-destructive",
    );
  });
});
