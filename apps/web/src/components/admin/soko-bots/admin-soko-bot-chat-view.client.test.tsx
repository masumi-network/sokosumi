import type {
  AdminSokoBotChatRoom,
  ChatRoomMessage,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadPageMock } = vi.hoisted(() => ({ loadPageMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Oct 1" }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  loadAdminSokoBotChatPageAction: (...args: unknown[]) => loadPageMock(...args),
}));
vi.mock("@/app/chat/components/room-message-row", () => ({
  ChannelMessageText: ({ content }: { content: string }) => <p>{content}</p>,
}));

import { AdminSokoBotChatView } from "./admin-soko-bot-chat-view.client";

function message(id: string, content: string, bot = false): ChatRoomMessage {
  return {
    id,
    content,
    createdAt: new Date("2026-10-01T08:00:00Z"),
    deletedAt: null,
    sender: bot
      ? {
          type: "sokoBot",
          sokoBot: { id: "bot", name: "Joseph" },
        }
      : { type: "user", user: { id: "owner", name: "Patrick" } },
  } as unknown as ChatRoomMessage;
}

const rooms: AdminSokoBotChatRoom[] = [
  {
    id: "room-1",
    isOwnerRoom: true,
    participants: [{ id: "owner", name: "Patrick" }],
    archived: false,
    lastActivityAt: "2026-10-01T08:00:00Z",
  },
  {
    id: "room-2",
    isOwnerRoom: false,
    participants: [{ id: "nina", name: "Nina" }],
    archived: false,
    lastActivityAt: "2026-09-30T08:00:00Z",
  },
];

describe("AdminSokoBotChatView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the transcript read-only with a room switcher", () => {
    render(
      <AdminSokoBotChatView
        sokoBotId="bot"
        botName="Joseph"
        rooms={rooms}
        selectedRoomId="room-1"
        initialMessages={[message("m1", "Hi"), message("m2", "Hello", true)]}
        initialCursor={null}
      />,
    );
    expect(screen.getByText("readOnly")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Joseph")).toBeInTheDocument();
    expect(screen.getByText("Nina")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("loadOlder")).not.toBeInTheDocument();
  });

  it("prepends older messages on demand", async () => {
    loadPageMock.mockResolvedValue({
      ok: true,
      value: { messages: [message("m0", "Earlier")], nextCursor: null },
    });
    render(
      <AdminSokoBotChatView
        sokoBotId="bot"
        botName="Joseph"
        rooms={rooms}
        selectedRoomId="room-1"
        initialMessages={[message("m1", "Hi")]}
        initialCursor="m1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "loadOlder" }));
    await waitFor(() =>
      expect(screen.getByText("Earlier")).toBeInTheDocument(),
    );
    expect(loadPageMock).toHaveBeenCalledWith({
      sokoBotId: "bot",
      roomId: "room-1",
      cursor: "m1",
    });
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Earlier");
  });

  it("explains an empty fleet bot", () => {
    render(
      <AdminSokoBotChatView
        sokoBotId="bot"
        botName={null}
        rooms={[]}
        selectedRoomId={null}
        initialMessages={[]}
        initialCursor={null}
      />,
    );
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
