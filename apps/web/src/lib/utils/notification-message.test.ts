import {
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { getNotificationMessageTranslationKey } from "./notification-message";

describe("getNotificationMessageTranslationKey", () => {
  it("puts a stored notification key under the Library namespace", () => {
    expect(
      getNotificationMessageTranslationKey("Notifications.Job.completed"),
    ).toBe("Library.Notifications.Job.completed");
  });

  it("leaves a key from another namespace where it is", () => {
    expect(
      getNotificationMessageTranslationKey("notifications.vendorGrant.pending"),
    ).toBe("notifications.vendorGrant.pending");
  });

  /**
   * Core counts the messages of a room onto one row rather than writing one
   * row per message, so past the first the line has to read as a count.
   */
  it("reads a counted room row as a count", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        roomName: "Design",
        count: 23,
      }),
    ).toBe(`Library.${CHAT_ROOM_MESSAGES_MESSAGE_KEY}`);
  });

  it("keeps the single-message line while the row stands for one message", () => {
    for (const messageParams of [{}, { count: 1 }]) {
      expect(
        getNotificationMessageTranslationKey(
          CHAT_ROOM_MESSAGE_MESSAGE_KEY,
          messageParams,
        ),
      ).toBe(`Library.${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`);
    }
  });

  /**
   * The count arrives as JSON a Core build wrote, so a string or a null is a
   * shape this reader can be handed rather than one it can rule out.
   */
  it("keeps the single-message line when the count is not a number", () => {
    for (const count of ["23", null, undefined, Number.NaN]) {
      expect(
        getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
          count,
        }),
      ).toBe(`Library.${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`);
    }
  });

  it("counts nothing but a room message", () => {
    expect(
      getNotificationMessageTranslationKey("Notifications.Chat.mentioned", {
        count: 23,
      }),
    ).toBe("Library.Notifications.Chat.mentioned");
  });
});
