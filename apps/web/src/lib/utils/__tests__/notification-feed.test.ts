import { describe, expect, it } from "vitest";

import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotificationKind,
} from "@/lib/utils/notification-feed";

describe("isBrowserOnlyNotificationKind", () => {
  it("treats CHAT as browser-only", () => {
    expect(isBrowserOnlyNotificationKind("CHAT")).toBe(true);
    expect(BROWSER_ONLY_NOTIFICATION_KINDS).toContain("CHAT");
  });

  it("keeps other kinds in the in-app feed", () => {
    expect(isBrowserOnlyNotificationKind("JOB")).toBe(false);
    expect(isBrowserOnlyNotificationKind("SYSTEM")).toBe(false);
  });
});
