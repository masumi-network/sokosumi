import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type RoomReadReceipts,
  useRoomReadReceipts,
} from "@/app/chat/hooks/use-room-read-receipts";
import type { ChatRoomReadEventData } from "@/lib/ably";
import type {
  ChatRoom,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

const ROOM_ID = "room-1";
const VIEWER_ID = "user-viewer";

function member(id: string, lastReadAt: Date | null): ChatRoomUserParticipant {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access: "member",
    lastReadAt,
  } as ChatRoomUserParticipant;
}

function makeRoom(members: ChatRoomUserParticipant[]): ChatRoom {
  return {
    id: ROOM_ID,
    userMembers: members,
    coworkerMembers: [],
    sokoBotMembers: [],
  } as unknown as ChatRoom;
}

let latest:
  | (RoomReadReceipts & {
      applyReadEvent: (event: ChatRoomReadEventData) => void;
    })
  | null = null;

function Probe({ room }: { room: ChatRoom | null }) {
  const receipts = useRoomReadReceipts({ room, currentUserId: VIEWER_ID });
  latest = receipts;
  return (
    <span data-testid="readers">
      {receipts.readers.map((reader) => reader.participant.id).join(",")}
    </span>
  );
}

function readerIds() {
  return screen.getByTestId("readers").textContent;
}

function apply(event: ChatRoomReadEventData) {
  act(() => {
    latest?.applyReadEvent(event);
  });
}

describe("useRoomReadReceipts", () => {
  it("seeds readers from the room payload, most-recent-read first", () => {
    render(
      <Probe
        room={makeRoom([
          member("user-a", new Date("2026-01-01T10:00:00.000Z")),
          member("user-b", new Date("2026-01-01T12:00:00.000Z")),
          member("user-c", null),
        ])}
      />,
    );

    expect(readerIds()).toBe("user-b,user-a");
    expect(latest?.nonReaders.map((member) => member.id)).toEqual(["user-c"]);
  });

  it("leaves the viewer out of both lists", () => {
    render(
      <Probe
        room={makeRoom([
          member(VIEWER_ID, new Date("2026-01-01T13:00:00.000Z")),
          member("user-a", null),
        ])}
      />,
    );

    expect(readerIds()).toBe("");
    expect(latest?.nonReaders.map((member) => member.id)).toEqual(["user-a"]);
  });

  it("moves a member from not-read to read when their event arrives", () => {
    render(<Probe room={makeRoom([member("user-a", null)])} />);
    expect(readerIds()).toBe("");

    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T10:00:00.000Z",
    });

    expect(readerIds()).toBe("user-a");
    expect(latest?.nonReaders).toHaveLength(0);
  });

  it("ignores an event for someone who is not on the roster", () => {
    render(<Probe room={makeRoom([member("user-a", null)])} />);

    apply({
      roomId: ROOM_ID,
      userId: "user-stranger",
      lastReadAt: "2026-01-01T10:00:00.000Z",
    });

    expect(readerIds()).toBe("");
  });

  it("ignores an event for another room", () => {
    render(<Probe room={makeRoom([member("user-a", null)])} />);

    apply({
      roomId: "room-2",
      userId: "user-a",
      lastReadAt: "2026-01-01T10:00:00.000Z",
    });

    expect(readerIds()).toBe("");
  });

  it("lets a later event replace an earlier one", () => {
    render(<Probe room={makeRoom([member("user-a", null)])} />);

    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T10:00:00.000Z",
    });
    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T11:00:00.000Z",
    });

    expect(latest?.readers[0]?.lastReadAt.toISOString()).toBe(
      "2026-01-01T11:00:00.000Z",
    );
  });

  it("never rewinds a mark with an out-of-order event", () => {
    render(<Probe room={makeRoom([member("user-a", null)])} />);

    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T11:00:00.000Z",
    });
    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T09:00:00.000Z",
    });

    expect(latest?.readers[0]?.lastReadAt.toISOString()).toBe(
      "2026-01-01T11:00:00.000Z",
    );
  });

  it("keeps the live mark when a later payload still carries the older one", () => {
    const stale = member("user-a", new Date("2026-01-01T09:00:00.000Z"));
    const view = render(<Probe room={makeRoom([stale])} />);

    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T11:00:00.000Z",
    });
    view.rerender(<Probe room={makeRoom([stale])} />);

    expect(latest?.readers[0]?.lastReadAt.toISOString()).toBe(
      "2026-01-01T11:00:00.000Z",
    );
  });

  it("counts the readers whose mark has reached a given moment", () => {
    render(
      <Probe
        room={makeRoom([
          member("user-a", new Date("2026-01-01T10:00:00.000Z")),
          member("user-b", new Date("2026-01-01T12:00:00.000Z")),
          member("user-c", null),
        ])}
      />,
    );

    expect(latest?.countReadAsOf("2026-01-01T09:00:00.000Z")).toBe(2);
    expect(latest?.countReadAsOf("2026-01-01T10:00:00.000Z")).toBe(2);
    expect(latest?.countReadAsOf("2026-01-01T11:00:00.000Z")).toBe(1);
    expect(latest?.countReadAsOf("2026-01-01T13:00:00.000Z")).toBe(0);
  });

  it("reports nothing without a room", () => {
    render(<Probe room={null} />);

    expect(readerIds()).toBe("");
    expect(latest?.countReadAsOf(new Date())).toBe(0);
  });

  it("forgets one room's live events when another room opens", () => {
    const view = render(<Probe room={makeRoom([member("user-a", null)])} />);
    apply({
      roomId: ROOM_ID,
      userId: "user-a",
      lastReadAt: "2026-01-01T10:00:00.000Z",
    });
    expect(readerIds()).toBe("user-a");

    const otherRoom = {
      ...makeRoom([member("user-a", null)]),
      id: "room-2",
    } as ChatRoom;
    view.rerender(<Probe room={otherRoom} />);

    expect(readerIds()).toBe("");
  });
});
