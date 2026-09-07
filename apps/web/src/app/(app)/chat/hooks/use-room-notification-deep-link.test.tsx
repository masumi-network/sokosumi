import { render, waitFor } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRoomMessageAction } from "@/app/chat/actions";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { useRoomNotificationDeepLink } from "./use-room-notification-deep-link";

vi.mock("@/app/chat/actions", () => ({
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
    jumpInRoom: vi.fn(async () => {}),
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

  it("spends the message from the URL so Back does not jump again", async () => {
    const props = params();

    render(<Harness {...props} />);

    expect(props.replace).toHaveBeenCalledExactlyOnceWith(
      "/chat/rooms/room-1",
      { scroll: false },
    );
  });
});
