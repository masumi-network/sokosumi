import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { resolveMessageLinkQuote } from "./message-link-quote";

type QuoteRoom = Parameters<typeof resolveMessageLinkQuote>[0]["targetRoom"];

function room(
  id: string,
  userIds: string[],
  overrides: Partial<Omit<QuoteRoom, "id" | "userMembers">> & {
    guestIds?: string[];
  } = {},
): QuoteRoom {
  const { guestIds = [], ...rest } = overrides;
  return {
    id,
    kind: "channel",
    discoverability: "private",
    organizationId: "org-1",
    userMembers: [
      ...userIds.map((userId) => ({ id: userId, access: "member" as const })),
      ...guestIds.map((userId) => ({ id: userId, access: "guest" as const })),
    ],
    ...rest,
  } as QuoteRoom;
}

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "msg-1",
    roomId: "source",
    content: "Earlier point about launch risk",
    deletedAt: null,
    membership: null,
    sender: { type: "user", user: { id: "alice", name: "Alice" } },
    ...overrides,
  } as ChatRoomMessage;
}

const link = { roomId: "source", messageId: "msg-1" };

describe("resolveMessageLinkQuote", () => {
  it("quotes a message from another room every target reader can read", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me", "alice"]),
      rooms: [room("source", ["me", "alice", "bob"])],
      allowCrossRoom: true,
      loadMessage: async () => message(),
    });

    expect(quote).toEqual({
      messageId: "msg-1",
      authorName: "Alice",
      snippet: "Earlier point about launch risk",
      attachment: null,
      roomId: "source",
    });
  });

  it("quotes a same-room message without a source room", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("source", ["me", "alice"]),
      rooms: [],
      allowCrossRoom: false,
      loadMessage: async () => message(),
    });

    expect(quote?.messageId).toBe("msg-1");
    expect(quote?.roomId).toBeUndefined();
  });

  it("stays a link when a target reader cannot read the source room", async () => {
    const loadMessage = vi.fn();
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me", "carol"]),
      rooms: [room("source", ["me", "alice"])],
      allowCrossRoom: true,
      loadMessage,
    });

    expect(quote).toBeNull();
    expect(loadMessage).not.toHaveBeenCalled();
  });

  it.each(["public", "external"] as const)(
    "quotes from a %s channel every organization member can join",
    async (discoverability) => {
      const quote = await resolveMessageLinkQuote({
        link,
        targetRoom: room("target", ["me", "carol"]),
        rooms: [room("source", ["me"], { discoverability })],
        allowCrossRoom: true,
        loadMessage: async () => message(),
      });

      expect(quote?.roomId).toBe("source");
    },
  );

  it("stays a link when a guest of the target room cannot join the public source channel", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me"], { guestIds: ["guest"] }),
      rooms: [room("source", ["me"], { discoverability: "public" })],
      allowCrossRoom: true,
      loadMessage: async () => message(),
    });

    expect(quote).toBeNull();
  });

  it("stays a link when the target room belongs to another organization", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me", "carol"], { organizationId: "org-2" }),
      rooms: [room("source", ["me"], { discoverability: "public" })],
      allowCrossRoom: true,
      loadMessage: async () => message(),
    });

    expect(quote).toBeNull();
  });

  it("stays a link when the source room is not one the sender can see", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me"]),
      rooms: [],
      allowCrossRoom: true,
      loadMessage: async () => message(),
    });

    expect(quote).toBeNull();
  });

  it("stays a link where only same-room quotes can be sent", async () => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("target", ["me"]),
      rooms: [room("source", ["me"])],
      allowCrossRoom: false,
      loadMessage: async () => message(),
    });

    expect(quote).toBeNull();
  });

  it.each([
    ["unreadable", null],
    ["deleted", message({ deletedAt: new Date() })],
    [
      "a membership status message",
      message({
        membership: {
          action: "joined",
          subject: { type: "user", id: "alice", name: "Alice" },
        },
      }),
    ],
  ])("stays a link when the message is %s", async (_label, loaded) => {
    const quote = await resolveMessageLinkQuote({
      link,
      targetRoom: room("source", ["me"]),
      rooms: [],
      allowCrossRoom: true,
      loadMessage: async () => loaded,
    });

    expect(quote).toBeNull();
  });
});
