import type {
  ChatFeedItem,
  ChatRoom,
  ChatRoomMessage,
} from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";

import { FeedSourceLine } from "./feed-source-line";

const { liveRooms } = vi.hoisted(() => ({
  liveRooms: { current: [] as ChatRoom[] },
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

function feedItem(
  room: ChatFeedItem["room"],
  parentMessageId: string | null = null,
): ChatFeedItem {
  return {
    lane: "feed",
    room,
    message: {
      id: "m1",
      roomId: room.id,
      parentMessageId,
      sender: {
        type: "user",
        user: { id: "user-2", name: "Ada Lovelace", email: "ada@example.com" },
      },
    } as unknown as ChatRoomMessage,
  };
}

function renderLine(item: ChatFeedItem) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FeedSourceLine item={item} currentUserId="user-1" />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId("feed-source-line");
}

describe("FeedSourceLine", () => {
  beforeEach(() => {
    liveRooms.current = [];
  });

  // The line is the reader's way back to the message. A wrong href drops
  // them in the room without the message, or in another room.
  it("names a channel and opens the message in its room", () => {
    const line = renderLine(
      feedItem({ id: "room-1", name: "launch-plans", kind: "channel" }),
    );

    expect(line).toHaveTextContent(/^#launch-plans$/);
    expect(line).toHaveAttribute("href", "/chat/rooms/room-1?message=m1");
  });

  // Without the marker a Thread reply reads as if it was said in the room.
  it("says a reply was said in a thread", () => {
    const line = renderLine(
      feedItem({ id: "room-1", name: "launch-plans", kind: "channel" }, "m0"),
    );

    expect(line).toHaveTextContent("#launch-plans · In a thread");
  });

  // A Direct's stored name is not one a person reads. The line must never
  // show it: it names the Direct as the sidebar does, else after the sender.
  it("names a Direct the reader has no live room for after its sender", () => {
    const line = renderLine(
      feedItem({ id: "dm-1", name: "direct-internal-name", kind: "direct" }),
    );

    expect(line).toHaveTextContent(/^Ada Lovelace$/);
  });

  it("names a Direct the way the sidebar does when its live room is known", () => {
    liveRooms.current = [
      {
        id: "dm-1",
        kind: "direct",
        name: "direct-internal-name",
        isSelfDirect: false,
        groupName: "Launch crew",
        userMembers: [],
      } as unknown as ChatRoom,
    ];

    const line = renderLine(
      feedItem({ id: "dm-1", name: "direct-internal-name", kind: "direct" }),
    );

    expect(line).toHaveTextContent(/^Launch crew$/);
  });
});
