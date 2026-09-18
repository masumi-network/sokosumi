import {
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { COWORKER_ACCESS_PENDING_MESSAGE_KEY } from "@/lib/utils/coworker-access-notification";
import {
  chatRoomMessageHref,
  getNotificationHref,
  parseChatRoomMessageLink,
} from "@/lib/utils/notification-href";
import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@/lib/utils/vendor-grant-notification";

describe("chatRoomMessageHref", () => {
  it("builds a room message link", () => {
    expect(chatRoomMessageHref("room-1", "msg-1")).toBe(
      "/chat/rooms/room-1?message=msg-1",
    );
  });

  it("trims the message id on a room message link", () => {
    expect(chatRoomMessageHref("room-1", "  msg-1  ")).toBe(
      "/chat/rooms/room-1?message=msg-1",
    );
  });

  it("drops a blank message id from a room message link", () => {
    expect(chatRoomMessageHref("room-1", "   ")).toBe("/chat/rooms/room-1");
  });

  it("encodes the room and message on a room message link", () => {
    expect(chatRoomMessageHref("room/with spaces", "a b")).toBe(
      "/chat/rooms/room%2Fwith%20spaces?message=a%20b",
    );
  });
});

describe("parseChatRoomMessageLink", () => {
  const ORIGIN = "https://app.sokosumi.com";

  it("reads back the link Copy link produces", () => {
    const link = `${ORIGIN}${chatRoomMessageHref("room/1", "msg 1")}`;
    expect(parseChatRoomMessageLink(link, ORIGIN)).toEqual({
      roomId: "room/1",
      messageId: "msg 1",
    });
  });

  it("ignores whitespace around the pasted link", () => {
    expect(
      parseChatRoomMessageLink(
        `  ${ORIGIN}/chat/rooms/room-1?message=msg-1\n`,
        ORIGIN,
      ),
    ).toEqual({ roomId: "room-1", messageId: "msg-1" });
  });

  it.each([
    ["another origin", "https://evil.example/chat/rooms/room-1?message=msg-1"],
    ["a relative path", "/chat/rooms/room-1?message=msg-1"],
    ["a room link without a message", `${ORIGIN}/chat/rooms/room-1`],
    ["a blank message param", `${ORIGIN}/chat/rooms/room-1?message=%20`],
    ["a deeper path", `${ORIGIN}/chat/rooms/room-1/files?message=msg-1`],
    ["an invitation link", `${ORIGIN}/chat/invites/inv-1?message=msg-1`],
    [
      "a link inside longer text",
      `look at ${ORIGIN}/chat/rooms/room-1?message=msg-1`,
    ],
    [
      "two links",
      `${ORIGIN}/chat/rooms/room-1?message=a ${ORIGIN}/chat/rooms/room-1?message=b`,
    ],
    [
      "credentials in the link",
      "https://u:p@app.sokosumi.com/chat/rooms/r?message=m",
    ],
    ["a malformed room id", `${ORIGIN}/chat/rooms/%E0%A4%A?message=msg-1`],
    ["plain text", "hello"],
  ])("does not match %s", (_label, text) => {
    expect(parseChatRoomMessageLink(text, ORIGIN)).toBeNull();
  });
});

describe("getNotificationHref", () => {
  it("returns job href with agentId", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: { agentId: "agent-1" },
      }),
    ).toBe("/agents/agent-1/jobs/job-1");
  });

  it("falls back to /tasks when job metadata lacks agentId", () => {
    expect(
      getNotificationHref({
        kind: "JOB",
        referenceId: "job-1",
        metadata: null,
      }),
    ).toBe("/tasks");
  });

  it("returns task href", () => {
    expect(
      getNotificationHref({
        kind: "TASK",
        referenceId: "task-1",
        metadata: null,
      }),
    ).toBe("/tasks/task-1");
  });

  it("deep-links CHAT notifications to the message", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "msg-1", workspaceId: "ws-1" },
      }),
    ).toBe("/chat/rooms/room-1?message=msg-1");
  });

  /**
   * A reminder is one press from the thing it reminds of, or it is worth less
   * than the notification the reader already missed. Core writes the follow-up
   * with the original's kind, reference and metadata, so these three say that
   * carrying those across is enough and no routing of its own is needed.
   *
   * Each names the destination outright. Asserting only that the reminder and
   * the original agree would pass just as well if both resolved to the same
   * wrong page.
   */
  it("sends a chat reminder exactly where the mention went", () => {
    const original = {
      kind: "CHAT",
      referenceId: "room-1",
      metadata: { messageId: "msg-1", workspaceId: "ws-1" },
    } as const;

    expect(
      getNotificationHref({
        ...original,
        messageKey: CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
      }),
    ).toBe("/chat/rooms/room-1?message=msg-1");
  });

  it("sends a task reminder exactly where the task notification went", () => {
    const original = {
      kind: "TASK",
      referenceId: "task-1",
      metadata: null,
    } as const;

    expect(
      getNotificationHref({
        ...original,
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
      }),
    ).toBe("/tasks/task-1");
  });

  it("sends a job reminder exactly where the job notification went", () => {
    const original = {
      kind: "JOB",
      referenceId: "job-1",
      metadata: { agentId: "agent-1" },
    } as const;

    expect(
      getNotificationHref({
        ...original,
        messageKey: JOB_FOLLOW_UP_MESSAGE_KEY,
      }),
    ).toBe("/agents/agent-1/jobs/job-1");
  });

  it("deep-links CHAT notifications to the room when no message is named", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { workspaceId: "ws-1" },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("ignores a CHAT messageId that is not a string", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: 7 },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("deep-links CHAT notifications to the room when the message is blank", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "" },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("deep-links CHAT notifications to the room when the message is spaces", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "   " },
      }),
    ).toBe("/chat/rooms/room-1");
  });

  it("encodes roomId in CHAT deep links", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room/with spaces",
        metadata: null,
      }),
    ).toBe("/chat/rooms/room%2Fwith%20spaces");
  });

  it("encodes the messageId in CHAT deep links", () => {
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "msg/1 2" },
      }),
    ).toBe("/chat/rooms/room-1?message=msg%2F1%202");
  });

  it("trims a padded messageId rather than encoding the padding", () => {
    // Padding survives to the room otherwise, as %20 either side of the id,
    // and the room looks for a message that cannot exist.
    expect(
      getNotificationHref({
        kind: "CHAT",
        referenceId: "room-1",
        metadata: { messageId: "  msg-1  " },
      }),
    ).toBe("/chat/rooms/room-1?message=msg-1");
  });

  it("deep-links pending vendor grant SYSTEM to personal review", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: { vendorGrantId: "grant-1" },
      }),
    ).toBe("/account#vendor-workspace-access");
  });

  it("deep-links pending vendor grant SYSTEM to org review", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "grant-1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        metadata: {
          vendorGrantId: "grant-1",
          organizationId: "org_1",
        },
      }),
    ).toBe("/organizations/org_1#vendor-workspace-access");
  });

  it("deep-links pending coworker access SYSTEM to personal review", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        metadata: { coworkerId: "c-1", workspaceId: "ws-1" },
      }),
    ).toBe("/account#coworker-early-access");
  });

  it("deep-links pending coworker access SYSTEM to org review by id when slug missing", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        metadata: {
          coworkerId: "c-1",
          organizationId: "org_1",
        },
      }),
    ).toBe("/organizations/org_1#coworker-early-access");
  });

  it("prefers organizationSlug for coworker access org deep links", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "access-1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        metadata: {
          coworkerId: "c-1",
          organizationId: "org_1",
          organizationSlug: "acme",
        },
      }),
    ).toBe("/organizations/acme#coworker-early-access");
  });

  it("falls back to home for non-pending SYSTEM notifications", () => {
    expect(
      getNotificationHref({
        kind: "SYSTEM",
        referenceId: "notice-1",
        messageKey: "notifications.system.generic",
        metadata: { vendorGrantId: "grant-1", roomId: "should-not-route" },
      }),
    ).toBe("/");
  });

  it("falls back to home for BILLING notifications", () => {
    expect(
      getNotificationHref({
        kind: "BILLING",
        referenceId: "invoice-1",
        metadata: { roomId: "should-not-route" },
      }),
    ).toBe("/");
  });
});
