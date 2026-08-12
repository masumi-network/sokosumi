import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  CLIENT_MESSAGE_ID_METADATA_KEY,
  confirmOutboundMessage,
  createPendingRoomMessage,
  failOutboundMessage,
  filterResolvedOutbound,
  isOutboundLocalMessage,
  markOutboundMessagePending,
  OUTBOUND_DELIVERY_STATUS_METADATA_KEY,
  outboundLocalMessageId,
  readClientTurnId,
  readOutboundDeliveryStatus,
  removeOutboundMessage,
} from "../outbound-room-message";

const senderUser = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  image: null,
  presence: "online" as const,
};

function serverMessage(
  id: string,
  content: string,
  clientTurnId?: string,
): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-08-12T12:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    sender: { type: "user", user: senderUser },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: clientTurnId
      ? { [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId }
      : null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}

describe("outbound room message", () => {
  it("creates a pending shell with client turn id and pending status", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello train",
      senderUser,
      createdAt: new Date("2026-08-12T12:00:01.000Z"),
      mentionedCoworkerIds: ["cow-1"],
    });

    expect(pending.id).toBe(outboundLocalMessageId("turn-1"));
    expect(isOutboundLocalMessage(pending)).toBe(true);
    expect(readClientTurnId(pending)).toBe("turn-1");
    expect(readOutboundDeliveryStatus(pending)).toBe("pending");
    expect(pending.content).toBe("hello train");
    expect(pending.sender).toEqual({ type: "user", user: senderUser });
    expect(pending.mentions).toEqual([
      {
        id: "pending-mention:turn-1:cow-1",
        coworkerId: "cow-1",
        status: "pending",
        responseMessageId: null,
      },
    ]);
  });

  it("confirms a pending shell in place without duplicating", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });
    const peer = serverMessage("peer-1", "hi");
    const confirmed = serverMessage("srv-1", "hello", "turn-1");

    const next = confirmOutboundMessage([peer, pending], confirmed);

    expect(next.map((row) => row.id)).toEqual(["peer-1", "srv-1"]);
    expect(next[1]?.content).toBe("hello");
    expect(isOutboundLocalMessage(next[1]!)).toBe(false);
  });

  it("confirms by known client turn id when response metadata omits it", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });
    const confirmed = serverMessage("srv-1", "hello");

    const next = confirmOutboundMessage([pending], confirmed, "turn-1");

    expect(next.map((row) => row.id)).toEqual(["srv-1"]);
    expect(readClientTurnId(next[0]!)).toBe("turn-1");
  });

  it("appends the confirmed row when no pending shell matches", () => {
    const peer = serverMessage("peer-1", "hi");
    const confirmed = serverMessage("srv-1", "hello", "turn-1");

    const next = confirmOutboundMessage([peer], confirmed, "turn-1");

    expect(next.map((row) => row.id)).toEqual(["peer-1", "srv-1"]);
  });

  it("keeps one row when the pending shell and the confirmed row both exist", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });
    const confirmed = serverMessage("srv-1", "hello", "turn-1");

    const next = confirmOutboundMessage(
      [pending, confirmed],
      confirmed,
      "turn-1",
    );

    expect(next.map((row) => row.id)).toEqual(["srv-1"]);
  });

  it("marks failed and can return to pending on retry", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });

    const failed = failOutboundMessage([pending], "turn-1");
    expect(readOutboundDeliveryStatus(failed[0]!)).toBe("failed");
    expect(failed[0]?.metadata?.[OUTBOUND_DELIVERY_STATUS_METADATA_KEY]).toBe(
      "failed",
    );

    const retried = markOutboundMessagePending(failed, "turn-1");
    expect(readOutboundDeliveryStatus(retried[0]!)).toBe("pending");
  });

  it("removes a failed send shell", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });
    const peer = serverMessage("peer-1", "hi");
    const next = removeOutboundMessage([peer, pending], "turn-1");
    expect(next.map((row) => row.id)).toEqual(["peer-1"]);
  });

  it("filters outbound shells resolved by incoming client turn ids", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hello",
      senderUser,
    });
    const other = createPendingRoomMessage({
      clientTurnId: "turn-2",
      roomId: "room-1",
      content: "next",
      senderUser,
    });
    const confirmed = serverMessage("srv-1", "hello", "turn-1");

    const remaining = filterResolvedOutbound([pending, other], [confirmed]);
    expect(remaining.map((row) => readClientTurnId(row))).toEqual(["turn-2"]);
  });

  it("reads client turn id from confirmed metadata", () => {
    const confirmed = serverMessage("srv-1", "hello", "turn-9");
    expect(readClientTurnId(confirmed)).toBe("turn-9");
    expect(readOutboundDeliveryStatus(confirmed)).toBeNull();
  });
});
