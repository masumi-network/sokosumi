import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  buildNotificationEmail,
  type NotificationEmailInput,
  notificationEmailDelayMs,
  taskAttentionReasonOf,
  taskUpdateReasonOf,
} from "./notification-email";

const BASE = "https://example.com";

function input(
  overrides: Partial<NotificationEmailInput> = {},
): NotificationEmailInput {
  return {
    kind: NotificationKind.CHAT,
    referenceId: "room-1",
    messageKey: CHAT_MENTION_MESSAGE_KEY,
    messageParams: {
      authorName: "Ada",
      messagePreview: "Can you check the pricing table?",
      roomName: "Design",
    },
    metadata: { messageId: "message-1" },
    recipientEmail: "reader@example.com",
    recipientName: "Grace",
    ...overrides,
  };
}

function textIn(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linkIn(html: string): string {
  return html.match(/href="([^"]+)"/)?.[1] ?? "";
}

describe("notificationEmailDelayMs", () => {
  it("holds each emailing category for its own while, shortest for a conversation", () => {
    expect(notificationEmailDelayMs("CHAT_DIRECT_MESSAGE")).toBe(5 * 60_000);
    expect(notificationEmailDelayMs("SYSTEM")).toBe(5 * 60_000);
    expect(notificationEmailDelayMs("CHAT_MENTION")).toBe(10 * 60_000);
    expect(notificationEmailDelayMs("CHAT_ROOM_MESSAGE")).toBe(10 * 60_000);
    expect(notificationEmailDelayMs("TASK_ATTENTION")).toBe(10 * 60_000);
    expect(notificationEmailDelayMs("TASK_COMPLETED")).toBe(30 * 60_000);
    expect(notificationEmailDelayMs("TASK_UPDATE")).toBe(30 * 60_000);
    expect(notificationEmailDelayMs("PROJECT_UPDATE")).toBe(10 * 60_000);
  });

  it("has no delay for a category that is not emailed at the event", () => {
    // Billing news is the one row Core never mails: Stripe already sends it.
    expect(notificationEmailDelayMs("BILLING_UPDATE")).toBeNull();
    // The sync mails the reminders on its own schedule.
    expect(notificationEmailDelayMs("FOLLOW_UP")).toBeNull();
    expect(notificationEmailDelayMs(null)).toBeNull();
  });
});

describe("taskAttentionReasonOf", () => {
  it("reads the reason off the end of an attention key", () => {
    expect(taskAttentionReasonOf("Notifications.Task.inputRequired")).toBe(
      "inputRequired",
    );
    expect(
      taskAttentionReasonOf("Notifications.Task.scheduleRemovedByOperator"),
    ).toBe("scheduleRemovedByOperator");
  });

  it("has no reason for a key outside the family", () => {
    expect(taskAttentionReasonOf("Notifications.Task.completed")).toBeNull();
    expect(taskAttentionReasonOf("Notifications.Task.newReason")).toBeNull();
  });
});

describe("taskUpdateReasonOf", () => {
  it("reads the reason off the end of an update key", () => {
    expect(taskUpdateReasonOf("Notifications.Task.canceled")).toBe("canceled");
    expect(taskUpdateReasonOf("Notifications.Task.failed")).toBe("failed");
    expect(taskUpdateReasonOf("Notifications.Task.scheduleRepaired")).toBe(
      "scheduleRepaired",
    );
  });

  it("falls back to the generic sentence for a key it does not know", () => {
    expect(taskUpdateReasonOf("Notifications.Task.somethingLater")).toBe(
      "updated",
    );
  });
});

describe("buildNotificationEmail", () => {
  it("sends a mention to the room, on the message that mentioned them", async () => {
    const email = await buildNotificationEmail(input());

    expect(email?.to).toBe("reader@example.com");
    expect(email?.tag).toBe("notification");
    expect(email?.subject).toBe("Sokosumi - Ada mentioned you in Design");
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/chat/rooms/room-1?message=message-1`,
    );
    expect(textIn(email?.html ?? "")).toContain(
      "Can you check the pricing table?",
    );
  });

  it("gives a mention in a room of two the direct-message wording", async () => {
    const email = await buildNotificationEmail(
      input({
        messageParams: { authorName: "Ada", isDirect: true, roomName: "Ada" },
      }),
    );

    expect(email?.subject).toBe("Sokosumi - Ada sent you a message");
  });

  it("sends a direct message to the room it was sent in", async () => {
    const email = await buildNotificationEmail(
      input({
        messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
        messageParams: { authorName: "Ada", messagePreview: "Hi" },
      }),
    );

    expect(email?.subject).toBe("Sokosumi - Ada sent you a message");
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/chat/rooms/room-1?message=message-1`,
    );
  });

  it("says what a task stopped for, and where it lives", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: "Notifications.Task.approvalRequired",
        messageParams: {
          coworkerName: "Atlas",
          projectName: "Launch",
          taskName: "Pricing review",
        },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Atlas needs your approval for Pricing review",
    );
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks/task-1`);
    expect(textIn(email?.html ?? "")).toContain("Launch");
  });

  it("tells the reader a task finished", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: "Notifications.Task.completed",
        messageParams: { coworkerName: "Atlas", taskName: "Pricing review" },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe("Sokosumi - Atlas completed Pricing review");
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks/task-1`);
  });

  it("asks the reader to review a vendor's request where web reviews it", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.SYSTEM,
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        messageParams: { vendorName: "Acme Agents" },
        metadata: { organizationId: "org-1", organizationSlug: "acme" },
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Acme Agents requested access to your workspace",
    );
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/organizations/acme#vendor-workspace-access`,
    );
    expect(textIn(email?.html ?? "")).toContain("vendor access");
  });

  it("asks the reader to review a coworker's request", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.SYSTEM,
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        messageParams: { coworkerName: "Atlas" },
        metadata: { organizationId: "org-1", organizationSlug: "acme" },
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Atlas requested access to your workspace",
    );
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/organizations/acme#coworker-early-access`,
    );
    expect(textIn(email?.html ?? "")).toContain("coworker early access");
  });

  it("names the room for unread room messages, and nobody in it", async () => {
    const email = await buildNotificationEmail(
      input({ messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY }),
    );

    expect(email?.subject).toBe("Sokosumi - Unread messages in Design");
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/chat/rooms/room-1?message=message-1`,
    );
    expect(textIn(email?.html ?? "")).toContain(
      "There are messages you have not read in Design.",
    );
    expect(textIn(email?.html ?? "")).not.toContain("Ada");
  });

  it("says what changed on a task that asked nothing of the reader", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: "Notifications.Task.canceled",
        messageParams: { projectName: "Launch", taskName: "Pricing review" },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe("Sokosumi - Pricing review was canceled");
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks/task-1`);
    expect(textIn(email?.html ?? "")).toContain("Launch");
  });

  it("gives a task key it does not know the generic sentence", async () => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: "Notifications.Task.somethingLater",
        messageParams: { taskName: "Pricing review" },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe("Sokosumi - Pricing review changed");
  });

  it("has no email for a chat key nobody mapped", async () => {
    await expect(
      buildNotificationEmail(
        input({ messageKey: "Notifications.Chat.somethingLater" }),
      ),
    ).resolves.toBeNull();
  });

  it("has no email for a system key it has no template for", async () => {
    await expect(
      buildNotificationEmail(
        input({
          kind: NotificationKind.SYSTEM,
          messageKey: "notifications.system.other",
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe("calendar and project notification emails", () => {
  it.each([
    ["scheduleUpdatedByMember", "A teammate updated the schedule for Report"],
    ["scheduleRemovedByMember", "A teammate removed the schedule for Report"],
    [
      "scheduleSourceChangedByMember",
      "A teammate moved Report to another calendar source",
    ],
    [
      "scheduleOccurrenceChangedByMember",
      "A teammate changed an occurrence of Report",
    ],
    ["scheduleRepaired", "The schedule for Report was repaired"],
    [
      "scheduleRemovedByOperator",
      "The schedule for Report was removed after review",
    ],
    ["failed", "Report failed"],
    ["canceled", "Report was canceled"],
  ])("renders %s with its task link", async (reason, message) => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task/1",
        messageKey: `Notifications.Task.${reason}`,
        messageParams: { taskName: "Report" },
      }),
    );
    expect(email?.subject).toBe(`Sokosumi - ${message}`);
    expect(textIn(email?.html ?? "")).toContain(message);
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks/task%2F1`);
  });

  it.each([
    ["closed", "Launch is now closed"],
    ["closeFailed", "Launch could not finish closing"],
  ])("renders project %s with its project link", async (outcome, message) => {
    const email = await buildNotificationEmail(
      input({
        kind: NotificationKind.PROJECT,
        referenceId: "project/1",
        messageKey: `Notifications.Project.${outcome}`,
        messageParams: { projectName: "Launch" },
      }),
    );
    expect(email?.subject).toBe(`Sokosumi - ${message}`);
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/projects/project%2F1`);
  });
});
