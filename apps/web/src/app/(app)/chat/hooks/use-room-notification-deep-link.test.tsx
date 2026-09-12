import { act, render, waitFor } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRoomMessageAction } from "@/app/chat/message-actions";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { useRoomNotificationDeepLink } from "./use-room-notification-deep-link";

vi.mock("@/app/chat/message-actions", () => ({
  getRoomMessageAction: vi.fn(),
}));

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "msg-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Hello",
    createdAt: "2026-08-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    metadata: null,
    replyCount: 0,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

type HarnessProps = Parameters<typeof useRoomNotificationDeepLink>[0];

function Harness(props: HarnessProps) {
  useRoomNotificationDeepLink(props);
  return null;
}

function params(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    roomId: "room-1",
    ready: true,
    pathname: "/chat/rooms/room-1",
    searchParams: new URLSearchParams(
      "message=msg-1",
    ) as unknown as ReadonlyURLSearchParams,
    replace: vi.fn(),
    highlight: vi.fn(() => false),
    isStillSelectedRoom: vi.fn(() => true),
    invalidateJump: vi.fn(),
    jumpInRoom: vi.fn(async () => true),
    jumpInThread: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("useRoomNotificationDeepLink", () => {
  beforeEach(() => {
    vi.mocked(getRoomMessageAction).mockReset();
    vi.mocked(getRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: message(),
    });
  });

  it("jumps to the message the URL names", async () => {
    const props = params();

    render(<Harness {...props} />);

    await waitFor(() => {
      expect(props.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-1");
    });
  });

  it("drops the jump when the reader has left the room it was started for", async () => {
    // A reader can click a second notification while the first is still
    // loading. The read is already in flight for the old room by then, so the
    // answer arrives after the move and has to be discarded.
    //
    // What it costs to act on it depends on where the message lives. A reply
    // opens the old room's thread over the new room. A top-level message is
    // cheaper: the jump it reaches still carries the old room's id, so it
    // spends a request on that room and lands nothing. Neither is wanted, and
    // this is the one check that stops both before they start.
    const props = params({ isStillSelectedRoom: vi.fn(() => false) });

    render(<Harness {...props} />);

    await waitFor(() => {
      expect(getRoomMessageAction).toHaveBeenCalledOnce();
    });

    expect(props.jumpInRoom).not.toHaveBeenCalled();
    expect(props.jumpInThread).not.toHaveBeenCalled();
  });

  it("lands the message the reader asked for last when two jumps overlap", async () => {
    // Two bell rows for the same room, clicked in quick succession. Both
    // reads are in flight at once, and the one clicked first comes back last.
    // The room guards cannot separate them: both jumps carry the same room.
    const resolvers = new Map<string, () => void>();
    vi.mocked(getRoomMessageAction).mockImplementation(
      (_roomId, messageId) =>
        new Promise((resolve) => {
          resolvers.set(messageId, () => {
            resolve({ ok: true as const, value: message({ id: messageId }) });
          });
        }),
    );

    const props = params();
    const { rerender } = render(<Harness {...props} />);
    rerender(
      <Harness
        {...props}
        searchParams={
          new URLSearchParams(
            "message=msg-2",
          ) as unknown as ReadonlyURLSearchParams
        }
      />,
    );

    await waitFor(() => {
      expect(resolvers.size).toBe(2);
    });

    await act(async () => {
      resolvers.get("msg-2")?.();
    });
    await act(async () => {
      resolvers.get("msg-1")?.();
    });

    expect(props.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-2");
  });

  it("still lands a jump the reader started before a detour to another room", async () => {
    // A jump started for another room says nothing about this one. Suppressing
    // on a single counter would drop this jump on the floor, and the URL
    // parameter has already been spent, so nothing would start it again.
    const resolvers = new Map<string, () => void>();
    vi.mocked(getRoomMessageAction).mockImplementation(
      (_roomId, messageId) =>
        new Promise((resolve) => {
          resolvers.set(messageId, () => {
            resolve({ ok: true as const, value: message({ id: messageId }) });
          });
        }),
    );

    const props = params();
    const { rerender } = render(<Harness {...props} />);
    await waitFor(() => {
      expect(resolvers.has("msg-1")).toBe(true);
    });

    rerender(
      <Harness
        {...props}
        roomId="room-2"
        pathname="/chat/rooms/room-2"
        searchParams={
          new URLSearchParams(
            "message=msg-2",
          ) as unknown as ReadonlyURLSearchParams
        }
      />,
    );
    await waitFor(() => {
      expect(resolvers.has("msg-2")).toBe(true);
    });

    // Back on the first room, with nothing left on its URL to re-trigger it.
    rerender(
      <Harness
        {...props}
        searchParams={
          new URLSearchParams("") as unknown as ReadonlyURLSearchParams
        }
      />,
    );

    await act(async () => {
      resolvers.get("msg-1")?.();
    });

    expect(props.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-1");
  });

  it("keeps a superseded jump superseded after a detour to another room", async () => {
    // Two jumps for this room and a third for another. One slot holding only
    // the last room would answer for room-2 here, and both of the room-1
    // jumps would read that as "not my room, so I am still newest". The
    // first would then land on top of the second.
    const resolvers = new Map<string, () => void>();
    vi.mocked(getRoomMessageAction).mockImplementation(
      (_roomId, messageId) =>
        new Promise((resolve) => {
          resolvers.set(messageId, () => {
            resolve({ ok: true as const, value: message({ id: messageId }) });
          });
        }),
    );

    const props = params();
    const { rerender } = render(<Harness {...props} />);
    rerender(
      <Harness
        {...props}
        searchParams={
          new URLSearchParams(
            "message=msg-2",
          ) as unknown as ReadonlyURLSearchParams
        }
      />,
    );
    await waitFor(() => {
      expect(resolvers.has("msg-2")).toBe(true);
    });

    rerender(
      <Harness
        {...props}
        roomId="room-2"
        pathname="/chat/rooms/room-2"
        searchParams={
          new URLSearchParams(
            "message=msg-3",
          ) as unknown as ReadonlyURLSearchParams
        }
      />,
    );
    await waitFor(() => {
      expect(resolvers.has("msg-3")).toBe(true);
    });

    await act(async () => {
      resolvers.get("msg-1")?.();
    });

    expect(props.jumpInRoom).not.toHaveBeenCalled();

    await act(async () => {
      resolvers.get("msg-2")?.();
    });

    expect(props.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-2");
  });

  it("spends the message from the URL so Back does not jump again", async () => {
    const props = params();

    render(<Harness {...props} />);

    expect(props.replace).toHaveBeenCalledExactlyOnceWith(
      "/chat/rooms/room-1",
      { scroll: false },
    );
  });
});
