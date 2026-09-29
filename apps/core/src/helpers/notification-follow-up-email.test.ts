import { NotificationKind } from "@sokosumi/database";
import {
  BILLING_FOLLOW_UP_MESSAGE_KEY,
  BILLING_LOW_BALANCE_MESSAGE_KEY,
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  buildFollowUpEmail,
  type FollowUpEmailInput,
} from "./notification-follow-up-email";

/**
 * Which reminder email a follow-up turns into, and where it opens (SOK-916).
 *
 * The four families share one builder and one tag, so the thing that can go
 * wrong is a row taking another family's words or another family's link. The
 * wording itself belongs to the email package's own tests; these pin the
 * choice.
 *
 * The base URL is the one the test environment sets (`src/test/setup.ts`).
 */
const BASE = "https://example.com";

function input(
  overrides: Partial<FollowUpEmailInput> = {},
): FollowUpEmailInput {
  return {
    kind: NotificationKind.CHAT,
    referenceId: "room-1",
    messageKey: CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
    sourceMessageKey: CHAT_MENTION_MESSAGE_KEY,
    messageParams: {
      authorName: "Ada",
      messagePreview: "Can you check the pricing table before Friday?",
      roomName: "Design",
    },
    metadata: { messageId: "message-1" },
    recipientEmail: "reader@example.com",
    recipientName: "Grace",
    ...overrides,
  };
}

/**
 * The rendered words, with the markup taken out.
 *
 * The zero-width run the preheader pads itself with goes too, and so does the
 * space a stripped tag leaves in front of punctuation: `<span>Project</span>:`
 * reads as `Project:` to anybody looking at the email.
 *
 * `&amp;` goes last. Taking it first turns `&amp;quot;` into `&quot;`, which
 * the next line then turns into a quotation mark the message never carried.
 */
function textIn(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:.,])/g, "$1")
    .trim();
}

/** What the reminder's button and pasted URL point at. */
function linkIn(html: string): string {
  const match = html.match(/href="([^"]+)"/);

  return match ? match[1] : "";
}

describe("buildFollowUpEmail", () => {
  it("sends a mention to the room, on the message that mentioned them", async () => {
    const email = await buildFollowUpEmail(input());

    expect(email?.subject).toBe(
      "Sokosumi - Ada is still waiting for you in Design",
    );
    expect(email?.to).toBe("reader@example.com");
    expect(email?.tag).toBe("notification-follow-up");
    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/chat/rooms/room-1?message=message-1`,
    );
  });

  /**
   * A room of two is named after the person in it, so the mention wording
   * would name them twice. Web swaps the same way when it renders the row.
   */
  it("gives a mention in a room of two the direct-message wording", async () => {
    const email = await buildFollowUpEmail(
      input({
        messageParams: { authorName: "Ada", isDirect: true, roomName: "Ada" },
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Ada is still waiting for your reply",
    );
  });

  it("sends a direct message to the room it was sent in", async () => {
    const email = await buildFollowUpEmail(
      input({
        messageKey: CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { authorName: "Ada" },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Ada is still waiting for your reply",
    );
    // No message to open, so the room itself.
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/chat/rooms/room-1`);
  });

  it("sends a task reminder to the task", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { taskName: "Invoice run" },
        metadata: null,
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Invoice run is still waiting for you",
    );
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks/task-1`);
  });

  /**
   * SOK-930 removed the job reminder with the job notifications it reminded
   * of. A row stored before that still reads in the Notification Center; it
   * is no longer mailed.
   */
  it("sends nothing for a job reminder", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.JOB,
        referenceId: "job-1",
        messageKey: JOB_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { jobName: "Nightly report" },
        metadata: { agentId: "agent-1" },
      }),
    );

    expect(email).toBeNull();
  });

  it("names the thing generically when the row does not name it", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
        messageParams: {},
        metadata: null,
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Your task is still waiting for you",
    );
  });

  it("escapes a reference that would otherwise change the URL", async () => {
    const email = await buildFollowUpEmail(
      input({ referenceId: "room 1/../admin", metadata: null }),
    );

    expect(linkIn(email?.html ?? "")).toBe(
      `${BASE}/chat/rooms/room%201%2F..%2Fadmin`,
    );
  });

  /**
   * The message itself, which is what tells a reader whether this needs them
   * now. Core keeps the preview on the row and takes it back when the message
   * is edited or deleted, so the email quotes what the app would show.
   */
  it("quotes the message a mention is about", async () => {
    const email = await buildFollowUpEmail(input());

    expect(textIn(email?.html ?? "")).toContain(
      "Can you check the pricing table before Friday?",
    );
  });

  it("quotes the message a direct message is about", async () => {
    const email = await buildFollowUpEmail(
      input({
        messageKey: CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
        sourceMessageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
        messageParams: { authorName: "Ada", messagePreview: "Ping me back?" },
      }),
    );

    expect(textIn(email?.html ?? "")).toContain("Ping me back?");
  });

  /**
   * A deleted message leaves the row without a preview, and the email without
   * a quote. An edit can also leave whitespace behind, which must read as no
   * message rather than as an empty quote, so the two emails are the same
   * email.
   */
  it("says the rest when there is no message to quote", async () => {
    const params = { authorName: "Ada", roomName: "Design" };

    const missing = await buildFollowUpEmail(input({ messageParams: params }));
    const blank = await buildFollowUpEmail(
      input({ messageParams: { ...params, messagePreview: "   " } }),
    );

    expect(textIn(missing?.html ?? "")).toContain(
      "Ada mentioned you in Design",
    );
    expect(blank?.html).toBe(missing?.html);
  });

  /**
   * A task stops for six different reasons. The reminder row collapses them to
   * one key so that two of them in a day is one reminder; the email reads the
   * source row, so it can still say which one.
   */
  it("says what the task stopped for, and where it lives", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
        sourceMessageKey: "Notifications.Task.approvalRequired",
        messageParams: {
          coworkerName: "Ada",
          projectName: "Billing",
          taskName: "Invoice run",
        },
        metadata: null,
      }),
    );

    const text = textIn(email?.html ?? "");

    expect(text).toContain(
      "Invoice run stopped a day ago because Ada needs your approval",
    );
    expect(text).toContain("Project: Billing");
  });

  /**
   * A key added to a family later has no sentence written for it. The email
   * falls back to the family's own body rather than asking the catalog for a
   * string nobody wrote, which would throw and cost the reader the email.
   */
  it("falls back to the family wording for a reason it has no sentence for", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
        sourceMessageKey: "Notifications.Task.somethingNobodyHasWordsFor",
        messageParams: { taskName: "Invoice run" },
        metadata: null,
      }),
    );

    expect(textIn(email?.html ?? "")).toContain(
      "Invoice run stopped a day ago because it needs you",
    );
  });

  it("sends a low-balance reminder to the credits tab, naming what was left", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.BILLING,
        referenceId: "org-1",
        messageKey: BILLING_FOLLOW_UP_MESSAGE_KEY,
        sourceMessageKey: BILLING_LOW_BALANCE_MESSAGE_KEY,
        messageParams: { credits: 42 },
        metadata: { workspaceId: "ws-1", organizationId: "org-1" },
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Your billing still needs your attention",
    );
    expect(textIn(email?.html ?? "")).toContain(
      "Your credits were running low a day ago, with 42 left",
    );
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/billing?tab=credits`);
  });

  it("does not mail a failed payment, which Stripe already mailed", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.BILLING,
        referenceId: "user-1",
        messageKey: BILLING_FOLLOW_UP_MESSAGE_KEY,
        sourceMessageKey: BILLING_PAYMENT_FAILED_MESSAGE_KEY,
        messageParams: {},
        metadata: { workspaceId: "ws-1", organizationId: null },
      }),
    );

    expect(email).toBeNull();
  });

  it("has no email for a message key that is not a reminder", async () => {
    expect(
      await buildFollowUpEmail(input({ messageKey: "Something.else" })),
    ).toBeNull();
  });
});
