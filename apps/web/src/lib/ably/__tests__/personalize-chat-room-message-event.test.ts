import { describe, expect, it } from "vitest";

import {
  personalizeChatRoomMessageEvent,
  personalizeReactionsForViewer,
} from "../personalize-chat-room-message-event";
import type { ChatRoomMessageEventData } from "../schema";

describe("personalizeReactionsForViewer", () => {
  it("sets reactedByCurrentUser from reactor ids", () => {
    const result = personalizeReactionsForViewer(
      [
        {
          emoji: "👍",
          count: 2,
          reactedByCurrentUser: false,
          reactors: [
            { id: "user_a", name: "A" },
            { id: "user_b", name: "B" },
          ],
        },
        {
          emoji: "🔥",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [{ id: "user_c", name: "C" }],
        },
      ],
      "user_b",
    );

    expect(result[0]?.reactedByCurrentUser).toBe(true);
    expect(result[1]?.reactedByCurrentUser).toBe(false);
  });
});

describe("personalizeChatRoomMessageEvent", () => {
  it("personalizes full create envelopes", () => {
    const event = {
      eventType: "create" as const,
      message: {
        id: "msg-1",
        roomId: "room-1",
        parentMessageId: null,
        content: "hi",
        createdAt: "2026-08-06T12:00:00.000Z",
        deletedAt: null,
        editedAt: null,
        sender: { type: "unknown" as const },
        mentions: [],
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reactedByCurrentUser: false,
            reactors: [{ id: "me", name: "Me" }],
          },
        ],
        threadReplyCount: 0,
        threadLastReplyAt: null,
        metadata: null,
        quote: null,
        membership: null,
        unfurls: null,
      },
    } satisfies ChatRoomMessageEventData;

    const personalized = personalizeChatRoomMessageEvent(event, "me");
    expect(personalized.eventType).toBe("create");
    if (personalized.eventType !== "create") {
      return;
    }
    const first = personalized.message.reactions[0] as {
      reactedByCurrentUser?: boolean;
    };
    expect(first.reactedByCurrentUser).toBe(true);
  });

  it("personalizes reaction patches only", () => {
    const event = {
      eventType: "reaction" as const,
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: {
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reactedByCurrentUser: false,
            reactors: [{ id: "me", name: "Me" }],
          },
        ],
      },
    } satisfies ChatRoomMessageEventData;

    const personalized = personalizeChatRoomMessageEvent(event, "me");
    expect(personalized.eventType).toBe("reaction");
    if (personalized.eventType !== "reaction") {
      return;
    }
    const first = personalized.patch.reactions[0] as {
      reactedByCurrentUser?: boolean;
    };
    expect(first.reactedByCurrentUser).toBe(true);
  });

  it("leaves unfurl patches unchanged", () => {
    const event = {
      eventType: "unfurl",
      messageId: "msg-1",
      roomId: "room-1",
      parentMessageId: null,
      patch: {
        unfurls: [
          {
            url: "https://example.com",
            title: "Example",
            description: null,
            imageUrl: null,
            siteName: null,
          },
        ],
      },
    } satisfies ChatRoomMessageEventData;

    expect(personalizeChatRoomMessageEvent(event, "me")).toEqual(event);
  });
});
