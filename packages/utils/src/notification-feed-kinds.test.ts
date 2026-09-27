import { describe, expect, it } from "vitest";

import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "./chat-notification-message-keys";
import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotification,
  isMentionNotification,
  isNeedsActionNotification,
  MENTION_MESSAGE_KEYS,
  NEEDS_ACTION_MESSAGE_KEYS,
} from "./notification-feed-kinds";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
} from "./notification-follow-up-message-keys";

describe("isBrowserOnlyNotification", () => {
  it("keeps a direct message out of the feed", () => {
    expect(
      isBrowserOnlyNotification("CHAT", CHAT_DIRECT_MESSAGE_MESSAGE_KEY),
    ).toBe(true);
    expect(BROWSER_ONLY_NOTIFICATION_KINDS).toEqual(["CHAT"]);
  });

  it("lets a mention and a room message into the feed", () => {
    expect(isBrowserOnlyNotification("CHAT", CHAT_MENTION_MESSAGE_KEY)).toBe(
      false,
    );
    expect(
      isBrowserOnlyNotification("CHAT", CHAT_ROOM_MESSAGE_MESSAGE_KEY),
    ).toBe(false);
  });

  it("lets both chat reminders into the feed", () => {
    expect(
      isBrowserOnlyNotification("CHAT", CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY),
    ).toBe(false);
    expect(
      isBrowserOnlyNotification(
        "CHAT",
        CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
      ),
    ).toBe(false);
  });

  it("keeps a chat key nobody mapped out of the feed", () => {
    expect(isBrowserOnlyNotification("CHAT", "Notifications.Chat.future")).toBe(
      true,
    );
  });

  it("keeps other kinds in the in-app feed", () => {
    expect(
      isBrowserOnlyNotification("JOB", "Notifications.Job.completed"),
    ).toBe(false);
    expect(isBrowserOnlyNotification("SYSTEM", "anything")).toBe(false);
    expect(isBrowserOnlyNotification("TASK", "anything")).toBe(false);
    expect(isBrowserOnlyNotification("BILLING", "anything")).toBe(false);
  });
});

describe("isNeedsActionNotification", () => {
  it("names the rows that ask the reader something", () => {
    expect(NEEDS_ACTION_MESSAGE_KEYS).toEqual([
      "Notifications.Task.inputRequired",
      "Notifications.Job.inputRequired",
      "notifications.vendorGrant.pending",
      "notifications.coworkerAccess.pending",
    ]);
    for (const key of NEEDS_ACTION_MESSAGE_KEYS) {
      expect(isNeedsActionNotification(key)).toBe(true);
    }
  });

  it("keeps news and other pauses out", () => {
    expect(isNeedsActionNotification("Notifications.Task.completed")).toBe(
      false,
    );
    expect(
      isNeedsActionNotification("Notifications.Task.approvalRequired"),
    ).toBe(false);
    expect(isNeedsActionNotification(CHAT_MENTION_MESSAGE_KEY)).toBe(false);
  });
});

describe("isMentionNotification", () => {
  it("names the rows where someone named the reader", () => {
    expect(MENTION_MESSAGE_KEYS).toEqual([
      "Notifications.Chat.mentioned",
      "Notifications.Chat.mentionedFollowUp",
    ]);
    for (const key of MENTION_MESSAGE_KEYS) {
      expect(isMentionNotification(key)).toBe(true);
    }
  });

  it("keeps direct messages and room messages out", () => {
    expect(isMentionNotification(CHAT_DIRECT_MESSAGE_MESSAGE_KEY)).toBe(false);
    expect(
      isMentionNotification(CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY),
    ).toBe(false);
    expect(isMentionNotification(CHAT_ROOM_MESSAGE_MESSAGE_KEY)).toBe(false);
  });
});
