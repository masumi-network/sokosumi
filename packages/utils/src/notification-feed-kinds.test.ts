import { describe, expect, it } from "vitest";

import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "./chat-notification-message-keys";
import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotification,
} from "./notification-feed-kinds";

describe("isBrowserOnlyNotification", () => {
  it("keeps a direct message out of the feed", () => {
    expect(
      isBrowserOnlyNotification("CHAT", CHAT_DIRECT_MESSAGE_MESSAGE_KEY),
    ).toBe(true);
    expect(BROWSER_ONLY_NOTIFICATION_KINDS).toEqual(["CHAT"]);
  });

  /**
   * The two stored keys. The counted and group keys are what web renders the
   * row under; Core never writes them, so a row never carries one.
   */
  it("lets a mention and a room message into the feed", () => {
    expect(isBrowserOnlyNotification("CHAT", CHAT_MENTION_MESSAGE_KEY)).toBe(
      false,
    );
    expect(
      isBrowserOnlyNotification("CHAT", CHAT_ROOM_MESSAGE_MESSAGE_KEY),
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
