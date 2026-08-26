import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSearchPanel } from "@/app/chat/components/room-search-panel";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

const getChatRoomMessagesMock = vi.fn();

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getChatRoomMessages: (...args: unknown[]) =>
      getChatRoomMessagesMock(...args),
  },
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const labels = {
  open: "Search in this chat",
  placeholder: "Search messages…",
  idle: "Type to search",
  empty: "No matches",
  loading: "Searching…",
  error: "Search failed",
  replyBadge: "Thread reply",
};

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    roomId: "550e8400-e29b-41d4-a716-446655440000",
    parentMessageId: null,
    content: "Hello budget review",
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

describe("RoomSearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChatRoomMessagesMock.mockResolvedValue({ data: [message()] });
  });

  it("opens search surface from the header control", async () => {
    render(
      <RoomSearchPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onJumpToMessage={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("room-search-trigger"));
    expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
    expect(screen.getByText(labels.idle)).toBeInTheDocument();
  });

  it("shows results after a debounced query", async () => {
    render(
      <RoomSearchPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onJumpToMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("room-search-trigger"));
    fireEvent.change(screen.getByTestId("room-search-input"), {
      target: { value: "budget" },
    });

    await waitFor(() => {
      expect(getChatRoomMessagesMock).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440000",
        expect.objectContaining({ q: "budget", limit: 50 }),
      );
    });

    expect(await screen.findByTestId("room-search-result")).toHaveTextContent(
      "Hello budget review",
    );
  });

  it("shows empty state when there are no matches", async () => {
    getChatRoomMessagesMock.mockResolvedValue({ data: [] });

    render(
      <RoomSearchPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onJumpToMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("room-search-trigger"));
    fireEvent.change(screen.getByTestId("room-search-input"), {
      target: { value: "zzzz" },
    });

    expect(await screen.findByTestId("room-search-empty")).toHaveTextContent(
      labels.empty,
    );
  });

  it("lists search hits in API order, newest first", async () => {
    const newer = message({
      id: "550e8400-e29b-41d4-a716-446655440002",
      content: "Newer budget",
    });
    const older = message({
      id: "550e8400-e29b-41d4-a716-446655440001",
      content: "Older budget",
    });
    getChatRoomMessagesMock.mockResolvedValue({ data: [newer, older] });

    render(
      <RoomSearchPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onJumpToMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("room-search-trigger"));
    fireEvent.change(screen.getByTestId("room-search-input"), {
      target: { value: "budget" },
    });

    const results = await screen.findAllByTestId("room-search-result");
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveTextContent("Newer budget");
    expect(results[1]).toHaveTextContent("Older budget");
  });

  it("closes the popover and jumps to the selected hit", async () => {
    const hit = message();
    const onJumpToMessage = vi.fn();
    getChatRoomMessagesMock.mockResolvedValue({ data: [hit] });

    render(
      <RoomSearchPanel
        roomId="550e8400-e29b-41d4-a716-446655440000"
        labels={labels}
        onJumpToMessage={onJumpToMessage}
      />,
    );

    fireEvent.click(screen.getByTestId("room-search-trigger"));
    fireEvent.change(screen.getByTestId("room-search-input"), {
      target: { value: "budget" },
    });

    fireEvent.click(await screen.findByTestId("room-search-result"));

    expect(onJumpToMessage).toHaveBeenCalledWith(hit);
    expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
  });
});
