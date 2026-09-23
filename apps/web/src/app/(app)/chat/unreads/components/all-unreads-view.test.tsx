import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import type { ChatRoom } from "@/lib/clients/generated/core";

import { AllUnreadsView } from "./all-unreads-view";

const { liveRooms, markAllActionMock, notifyMock } = vi.hoisted(() => ({
  liveRooms: { current: [] as ChatRoom[] },
  markAllActionMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));

vi.mock("@/app/chat/actions", () => ({
  markAllChatUnreadReadAction: (...args: unknown[]) =>
    markAllActionMock(...args),
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: (...args: unknown[]) =>
    notifyMock(...args),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// The room marks draw faces and kind glyphs, which their own tests cover.
vi.mock("@/components/chat/channel-room-mark", () => ({
  ChannelRoomMark: () => <span>#</span>,
}));
vi.mock("@/components/chat/direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => <span>@</span>,
}));

const threadsOnly = makeRoom({
  id: "room-threads",
  name: "sokosumi",
  unreadCount: 2,
  channelUnreadCount: 0,
  threadUnreadCount: 2,
  unreadThreadCount: 1,
  unreadThreads: [
    {
      parentMessageId: "p1",
      firstUnreadReplyId: "r1",
      parentContent: "should be vendor-wide",
      unreadReplyCount: 2,
      unreadMentionCount: 0,
    },
  ],
});
const channel = makeRoom({
  id: "room-channel",
  name: "everyone",
  unreadCount: 3,
  channelUnreadCount: 3,
});
const read = makeRoom({ id: "room-read", name: "design" });

function renderView(rooms: ChatRoom[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AllUnreadsView initialRooms={rooms} currentUserId="user-1" />
    </NextIntlClientProvider>,
  );
}

function roomNames() {
  return screen
    .getAllByTestId("all-unreads-room")
    .map((row) => within(row).getAllByRole("link")[0]?.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  liveRooms.current = [];
  markAllActionMock.mockResolvedValue({ ok: true, value: null });
});

describe("AllUnreadsView", () => {
  it("lists rooms with top-level unread first, each with its unread Threads inset", () => {
    renderView([threadsOnly, read, channel]);

    const names = roomNames();
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("everyone");
    expect(names[1]).toContain("sokosumi");
    const threadRow = within(
      screen.getAllByTestId("all-unreads-room")[1] as HTMLElement,
    ).getByRole("link", { name: /should be vendor-wide/ });
    expect(threadRow).toHaveAttribute(
      "href",
      "/chat/rooms/room-threads?message=r1",
    );
  });

  it("follows the live rooms over the cached ones", () => {
    liveRooms.current = [{ ...channel, unreadCount: 0, channelUnreadCount: 0 }];
    renderView([channel]);

    expect(screen.getByText("You’re all caught up")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).toBeNull();
  });

  it("marks every room read through the reads each one needs", async () => {
    renderView([threadsOnly, channel]);

    await userEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );

    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    expect(markAllActionMock).toHaveBeenCalledWith([
      { roomId: "room-channel", readRoom: true, lookThreads: false },
      { roomId: "room-threads", readRoom: false, lookThreads: true },
    ]);
    expect(notifyMock).toHaveBeenCalledWith({ collections: ["active"] });
  });
});
