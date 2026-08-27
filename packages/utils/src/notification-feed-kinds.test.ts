import { describe, expect, it } from "vitest";

import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotificationKind,
} from "./notification-feed-kinds";

describe("isBrowserOnlyNotificationKind", () => {
  it("treats CHAT as browser-only", () => {
    expect(isBrowserOnlyNotificationKind("CHAT")).toBe(true);
    expect(BROWSER_ONLY_NOTIFICATION_KINDS).toEqual(["CHAT"]);
  });

  it("keeps other kinds in the in-app feed", () => {
    expect(isBrowserOnlyNotificationKind("JOB")).toBe(false);
    expect(isBrowserOnlyNotificationKind("SYSTEM")).toBe(false);
    expect(isBrowserOnlyNotificationKind("TASK")).toBe(false);
    expect(isBrowserOnlyNotificationKind("BILLING")).toBe(false);
  });
});
