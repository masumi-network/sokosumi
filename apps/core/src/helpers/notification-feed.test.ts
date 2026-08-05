import { NotificationKind } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { notificationFeedKindWhere } from "./notification-feed";

describe("notificationFeedKindWhere", () => {
  it("excludes CHAT from the default in-app feed", () => {
    expect(notificationFeedKindWhere()).toEqual({
      notIn: [NotificationKind.CHAT],
    });
  });

  it("drops CHAT when an explicit kind filter includes it", () => {
    expect(
      notificationFeedKindWhere([
        NotificationKind.JOB,
        NotificationKind.CHAT,
        NotificationKind.TASK,
      ]),
    ).toEqual({
      in: [NotificationKind.JOB, NotificationKind.TASK],
    });
  });

  it("matches nothing when the only requested kind is browser-only", () => {
    expect(notificationFeedKindWhere([NotificationKind.CHAT])).toEqual({
      in: [],
    });
  });

  it("keeps non-chat kinds as an explicit in filter", () => {
    expect(
      notificationFeedKindWhere([
        NotificationKind.JOB,
        NotificationKind.SYSTEM,
      ]),
    ).toEqual({
      in: [NotificationKind.JOB, NotificationKind.SYSTEM],
    });
  });
});
