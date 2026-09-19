import { NotificationKind } from "@sokosumi/database";
import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { notificationEmailLink, readString } from "./notification-email-link";

const BASE = "https://example.com";

describe("notificationEmailLink", () => {
  it("opens a task on its page", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.TASK,
        referenceId: "task 1",
        messageKey: "Notifications.Task.completed",
        metadata: null,
      }),
    ).toBe(`${BASE}/tasks/task%201`);
  });

  it("opens a chat room on the message it is about", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.CHAT,
        referenceId: "room-1",
        messageKey: "Notifications.Chat.mentioned",
        metadata: { messageId: " msg/1 " },
      }),
    ).toBe(`${BASE}/chat/rooms/room-1?message=msg%2F1`);
  });

  it("opens the room itself when the row names no message", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.CHAT,
        referenceId: "room-1",
        messageKey: "Notifications.Chat.mentioned",
        metadata: { messageId: "  " },
      }),
    ).toBe(`${BASE}/chat/rooms/room-1`);
  });

  it("reviews a vendor request on the organization, by its slug", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.SYSTEM,
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: { organizationId: "org-1", organizationSlug: "acme" },
      }),
    ).toBe(`${BASE}/organizations/acme#vendor-workspace-access`);
  });

  // The review page resolves by slug, so the id reaches the same route and
  // is answered with a 404. The account page is the wrong page rather than a
  // dead one, and a row that carries no slug is a personal workspace anyway.
  it("does not address an organization by its id", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.SYSTEM,
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: { organizationId: "org-1" },
      }),
    ).toBe(`${BASE}/account#vendor-workspace-access`);
  });

  it("reviews a coworker request by the organization's slug when the row carries one", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.SYSTEM,
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        metadata: { organizationId: "org-1", organizationSlug: "acme" },
      }),
    ).toBe(`${BASE}/organizations/acme#coworker-early-access`);
  });

  it("reviews a request for a personal workspace on the account page", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.SYSTEM,
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        metadata: { organizationId: null },
      }),
    ).toBe(`${BASE}/account#coworker-early-access`);
  });

  it("lands on the home page for a kind with nothing of its own to open", () => {
    expect(
      notificationEmailLink({
        kind: NotificationKind.SYSTEM,
        referenceId: "x",
        messageKey: "notifications.system.other",
        metadata: null,
      }),
    ).toBe(`${BASE}/`);
    expect(
      notificationEmailLink({
        kind: NotificationKind.BILLING,
        referenceId: "x",
        messageKey: "Notifications.Billing.x",
        metadata: null,
      }),
    ).toBe(`${BASE}/`);
  });
});

describe("readString", () => {
  it("reads a string and nothing else", () => {
    expect(readString({ name: "Ada" }, "name")).toBe("Ada");
    expect(readString({ name: 1 }, "name")).toBeNull();
    expect(readString(null, "name")).toBeNull();
    expect(readString(undefined, "name")).toBeNull();
  });
});
