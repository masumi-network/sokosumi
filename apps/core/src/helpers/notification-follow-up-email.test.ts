import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
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
    messageParams: { authorName: "Ada", roomName: "Design" },
    metadata: { messageId: "message-1" },
    recipientEmail: "reader@example.com",
    recipientName: "Grace",
    ...overrides,
  };
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

  it("sends a job reminder to the job, under its agent", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.JOB,
        referenceId: "job-1",
        messageKey: JOB_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { jobName: "Nightly report" },
        metadata: { agentId: "agent-1" },
      }),
    );

    expect(email?.subject).toBe(
      "Sokosumi - Nightly report is still waiting for you",
    );
    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/agents/agent-1/jobs/job-1`);
  });

  /** No agent id, no job URL. Web sends the reader to the list rather than nowhere. */
  it("falls back to the task list for a job with no agent", async () => {
    const email = await buildFollowUpEmail(
      input({
        kind: NotificationKind.JOB,
        referenceId: "job-1",
        messageKey: JOB_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { jobName: "Nightly report" },
        metadata: null,
      }),
    );

    expect(linkIn(email?.html ?? "")).toBe(`${BASE}/tasks`);
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

  it("has no email for a message key that is not a reminder", async () => {
    expect(
      await buildFollowUpEmail(input({ messageKey: "Something.else" })),
    ).toBeNull();
  });
});
