import {
  CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY,
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
  it("keeps the single-message line when the count is not a whole number", () => {
    for (const count of ["23", null, undefined, Number.NaN, 1.5]) {
      expect(
        getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
          count,
        }),
      ).toBe(`Library.${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`);
    }
  });

  /**
   * A banner interrupts because a message just arrived, so it says that
   * message. The push service worker renders the stored key and knows nothing
   * of counts, so a counted banner here would be a second answer for a reader
   * whose tab happened to be open.
   */
  it("leaves the count out when the caller asks for the arrival", () => {
    expect(
      getNotificationMessageTranslationKey(
        CHAT_ROOM_MESSAGE_MESSAGE_KEY,
        { roomName: "Design", count: 23 },
        { counted: false },
      ),
    ).toBe(`Library.${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`);
  });

  /**
   * A room of three or more people has no name but the list of who is in it,
   * so "Ada, Ben, Cara" alone reads as three people rather than as somewhere
   * a message was written.
   */
  it("names a room of people as a group", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        roomName: "Ada, Ben, Cara",
        isGroup: true,
      }),
    ).toBe(`Library.${CHAT_ROOM_MESSAGE_GROUP_MESSAGE_KEY}`);
  });

  it("counts a group's messages as a group's", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        roomName: "Ada, Ben, Cara",
        isGroup: true,
        count: 23,
      }),
    ).toBe(`Library.${CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY}`);
  });

  it("leaves a named channel unnamed as a group", () => {
    for (const isGroup of [undefined, false, "true"]) {
      expect(
        getNotificationMessageTranslationKey(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
          roomName: "Design",
          isGroup,
          count: 23,
        }),
      ).toBe(`Library.${CHAT_ROOM_MESSAGES_MESSAGE_KEY}`);
    }
  });

  /**
   * The group wording is the feed's, like the count. The banner and the push
   * both render the stored key, so both say the same thing.
   */
  it("leaves the group out when the caller asks for the arrival", () => {
    expect(
      getNotificationMessageTranslationKey(
        CHAT_ROOM_MESSAGE_MESSAGE_KEY,
        { roomName: "Ada, Ben, Cara", isGroup: true },
        { counted: false },
      ),
    ).toBe(`Library.${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`);
  });

  it("counts nothing but a room message", () => {
    expect(
      getNotificationMessageTranslationKey("Notifications.Chat.mentioned", {
        count: 23,
      }),
    ).toBe("Library.Notifications.Chat.mentioned");
  });
});
