import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { buildNotificationBannerContent } from "./notification-banner";

const APP_TITLE = "Sokosumi";

/** Stands in for the catalog: the key back, so a test can name what it read. */
function translate(messageKey: string): string {
  return `rendered:${messageKey}`;
}

function content(
  messageKey: string,
  messageParams: Record<string, unknown> = {},
) {
  return buildNotificationBannerContent({
    messageKey,
    messageParams,
    appTitle: APP_TITLE,
    translate,
  });
}

describe("buildNotificationBannerContent", () => {
  it("shows the room-wide mention in the reader's language", () => {
    expect(
      content(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        roomName: "Design",
        messagePreview: "please add @all tagging",
      }).body,
    ).toBe("please add @rendered:Notifications.Chat.mentionAll tagging");
  });

  it.each([
    CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
    CHAT_MENTION_MESSAGE_KEY,
    CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  ])(
    "uses the count instead of the latest preview for grouped %s banners",
    (messageKey) => {
      expect(
        content(messageKey, {
          authorName: "Ada",
          roomName: "Design",
          count: 3,
          messagePreview: "latest message",
        }),
      ).toEqual({ title: APP_TITLE, body: `rendered:${messageKey}` });
    },
  );

  it.each([undefined, "", "   ", 12, null])(
    "uses the author when the room name is unavailable (%s)",
    (roomName) => {
      for (const messageKey of [
        CHAT_ROOM_MESSAGE_MESSAGE_KEY,
        CHAT_MENTION_MESSAGE_KEY,
      ]) {
        for (const isGroup of [false, true]) {
          expect(
            content(messageKey, {
              authorName: "Ada",
              roomName,
              isGroup,
              messagePreview: "hello",
            }),
          ).toEqual({ title: "Ada", body: "hello" });
        }
      }
    },
  );

  it("titles a room message with who wrote and where", () => {
    expect(
      content(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        roomName: "Design",
        messagePreview: "can you look at the login flow",
      }),
    ).toEqual({
      title: `rendered:${CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY}`,
      body: "can you look at the login flow",
    });
  });

  it("says a room of people is a group", () => {
    expect(
      content(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        roomName: "Ada, Ben, Cara",
        isGroup: true,
        messagePreview: "standup in five",
      }).title,
    ).toBe(`rendered:${CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY}`);
  });

  it("keeps the mention line as the title, because it says why it arrived", () => {
    expect(
      content(CHAT_MENTION_MESSAGE_KEY, {
        authorName: "Ada",
        roomName: "Design",
        messagePreview: "your call",
      }),
    ).toEqual({
      title: `rendered:${CHAT_MENTION_MESSAGE_KEY}`,
      body: "your call",
    });
  });

  /**
   * A direct room is named after the people in it, so its name is not the
   * author's. Ben's banner for a message from Ada must say Ada, not Ben.
   */
  it("titles a direct message with the author alone", () => {
    expect(
      content(CHAT_DIRECT_MESSAGE_MESSAGE_KEY, {
        authorName: "Ada",
        roomName: "Ben",
        messagePreview: "are you free?",
      }),
    ).toEqual({ title: "Ada", body: "are you free?" });
  });

  it.each([undefined, "", 12, null])(
    "keeps chat titles without preview text (%s)",
    (messagePreview) => {
      for (const [messageKey, title, isGroup] of [
        [
          CHAT_ROOM_MESSAGE_MESSAGE_KEY,
          `rendered:${CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY}`,
          false,
        ],
        [
          CHAT_ROOM_MESSAGE_MESSAGE_KEY,
          `rendered:${CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY}`,
          true,
        ],
        [CHAT_DIRECT_MESSAGE_MESSAGE_KEY, "Ada", false],
        [
          CHAT_MENTION_MESSAGE_KEY,
          `rendered:${CHAT_MENTION_MESSAGE_KEY}`,
          false,
        ],
      ] as const) {
        expect(
          content(messageKey, {
            authorName: "Ada",
            roomName: "Design",
            isGroup,
            messagePreview,
          }),
        ).toEqual({ title, body: "" });
      }
    },
  );

  /**
   * Every chat title names the author, so a blank name would put an empty
   * bold line on the banner, or " in Design" for a room. A stored name can be
   * blank: Core trims a name at signup and keeps whatever is left.
   */
  it("falls back to the app name when the message has no author to name", () => {
    const directFallback = {
      title: APP_TITLE,
      body: `rendered:${CHAT_DIRECT_MESSAGE_MESSAGE_KEY}`,
    };

    expect(
      content(CHAT_DIRECT_MESSAGE_MESSAGE_KEY, {
        messagePreview: "are you free?",
      }),
    ).toEqual(directFallback);
    expect(
      content(CHAT_DIRECT_MESSAGE_MESSAGE_KEY, {
        authorName: "",
        messagePreview: "are you free?",
      }),
    ).toEqual(directFallback);
    expect(
      content(CHAT_ROOM_MESSAGE_MESSAGE_KEY, {
        authorName: "",
        roomName: "Design",
        messagePreview: "can you look at the login flow",
      }),
    ).toEqual({
      title: APP_TITLE,
      body: `rendered:${CHAT_ROOM_MESSAGE_MESSAGE_KEY}`,
    });
    // A mention's title is a catalog line rather than the name itself, and
    // it names the author too: " mentioned you in Design" without this.
    expect(
      content(CHAT_MENTION_MESSAGE_KEY, {
        authorName: "",
        roomName: "Design",
        messagePreview: "your call",
      }),
    ).toEqual({
      title: APP_TITLE,
      body: `rendered:${CHAT_MENTION_MESSAGE_KEY}`,
    });
  });

  it("leaves every other notification kind titled with the app name", () => {
    const line = {
      title: APP_TITLE,
      body: "rendered:Notifications.Task.completed",
    };

    expect(
      content("Notifications.Task.completed", { taskName: "Weekly report" }),
    ).toEqual(line);
    // Chat's own params on a kind that is not chat. Core writes neither on a
    // task, so this says the key decides the title, not the params beside it.
    expect(
      content("Notifications.Task.completed", {
        taskName: "Weekly report",
        authorName: "Ada",
        messagePreview: "done",
      }),
    ).toEqual(line);
  });
  /**
   * The title of a mention in a room of two is the author, the way a direct
   * message's is. Rendering the mention line there would name them twice.
   */
  it("titles a mention in a room of two with the author", () => {
    expect(
      content(CHAT_MENTION_MESSAGE_KEY, {
        authorName: "Ada",
        isDirect: true,
        messagePreview: "your call",
      }),
    ).toEqual({ title: "Ada", body: "your call" });
  });
});
