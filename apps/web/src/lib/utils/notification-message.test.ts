import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGES_MESSAGE_KEY,
  CHAT_MENTION_DIRECT_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
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
   * One banner holds a whole room, so a mention that arrives on top of other
   * messages stands for all of them. What they have in common is the room, so
   * the count reads as the room's however the newest arrival was stored.
   */
  it("counts a stacked mention as the room's messages", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_MENTION_MESSAGE_KEY, {
        roomName: "Design",
        count: 3,
      }),
    ).toBe(`Library.${CHAT_ROOM_MESSAGES_MESSAGE_KEY}`);
  });

  /**
   * A direct room's name is the other person, so "3 messages in Ada" reads as
   * a place rather than a person. The sender is the one thing the reader
   * needs, and there is only ever one of them.
   */
  it("counts a stacked direct message as the sender's", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_DIRECT_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        count: 3,
      }),
    ).toBe(`Library.${CHAT_DIRECT_MESSAGES_MESSAGE_KEY}`);
  });

  it("keeps the single-message line for one direct message", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_DIRECT_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        count: 1,
      }),
    ).toBe(`Library.${CHAT_DIRECT_MESSAGE_MESSAGE_KEY}`);
  });

  it("counts a stacked mention in a room of people as a group's", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_MENTION_MESSAGE_KEY, {
        roomName: "Ada, Ben, Cara",
        isGroup: true,
        count: 3,
      }),
    ).toBe(`Library.${CHAT_ROOM_MESSAGES_GROUP_MESSAGE_KEY}`);
  });

  /**
   * Only chat groups into one banner and only a room's messages are counted
   * onto one row. A job or a task each happened once, so a count on one is a
   * payload this reader was not written for.
   */
  it("counts nothing outside chat", () => {
    expect(
      getNotificationMessageTranslationKey("Notifications.Job.completed", {
        count: 23,
      }),
    ).toBe("Library.Notifications.Job.completed");
  });
  /**
   * A direct room of two is named after the other person, who in a mention is
   * whoever wrote it. "Ada mentioned you in Ada" says one name twice and no
   * place at all, so the line names the kind of room instead.
   */
  it("reads a mention in a room of two as a direct message", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_MENTION_MESSAGE_KEY, {
        authorName: "Ada",
        isDirect: true,
      }),
    ).toBe(`Library.${CHAT_MENTION_DIRECT_MESSAGE_KEY}`);
  });

  it("counts mentions in a room of two the way its messages are counted", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_MENTION_MESSAGE_KEY, {
        authorName: "Ada",
        isDirect: true,
        count: 3,
      }),
    ).toBe(`Library.${CHAT_DIRECT_MESSAGES_MESSAGE_KEY}`);
  });

  it("leaves a mention in a named room naming that room", () => {
    expect(
      getNotificationMessageTranslationKey(CHAT_MENTION_MESSAGE_KEY, {
        roomName: "Design",
      }),
    ).toBe(`Library.${CHAT_MENTION_MESSAGE_KEY}`);
  });
});
