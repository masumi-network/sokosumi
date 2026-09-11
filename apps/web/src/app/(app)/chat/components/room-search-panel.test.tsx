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

const platform = { isApple: true, isMobile: false };

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => platform.isApple,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => platform.isMobile,
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

function renderPanel(onJumpToMessage = vi.fn()) {
  render(
    <RoomSearchPanel
      roomId="550e8400-e29b-41d4-a716-446655440000"
      labels={labels}
      onJumpToMessage={onJumpToMessage}
    />,
  );
  return onJumpToMessage;
}

/** Opens the results surface the way the current viewport exposes it. */
function openSearch() {
  if (platform.isMobile) {
    fireEvent.click(screen.getByTestId("room-search-trigger"));
    return;
  }
  fireEvent.click(screen.getByTestId("room-search-input"));
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByTestId("room-search-input"), {
    target: { value },
  });
}

describe("RoomSearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.isApple = true;
    platform.isMobile = false;
    getChatRoomMessagesMock.mockResolvedValue({ data: [message()] });
  });

  it("shows the search field in the header before the results open", () => {
    renderPanel();

    expect(screen.getByTestId("room-search-input")).toBeInTheDocument();
    expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();

    openSearch();

    expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
    expect(screen.getByText(labels.idle)).toBeInTheDocument();
  });

  it("shows results after a debounced query", async () => {
    renderPanel();

    openSearch();
    typeQuery("budget");

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

    renderPanel();
    openSearch();
    typeQuery("zzzz");

    expect(await screen.findByTestId("room-search-empty")).toHaveTextContent(
      labels.empty,
    );
  });

  it("lists search hits in API order, newest first", async () => {
    getChatRoomMessagesMock.mockResolvedValue({
      data: [
        message({
          id: "550e8400-e29b-41d4-a716-446655440002",
          content: "Newer budget",
        }),
        message({
          id: "550e8400-e29b-41d4-a716-446655440001",
          content: "Older budget",
        }),
      ],
    });

    renderPanel();
    openSearch();
    typeQuery("budget");

    const results = await screen.findAllByTestId("room-search-result");
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveTextContent("Newer budget");
    expect(results[1]).toHaveTextContent("Older budget");
  });

  it("closes the popover and jumps to the selected hit", async () => {
    const hit = message();
    getChatRoomMessagesMock.mockResolvedValue({ data: [hit] });
    const onJumpToMessage = renderPanel();

    openSearch();
    typeQuery("budget");
    fireEvent.click(await screen.findByTestId("room-search-result"));

    expect(onJumpToMessage).toHaveBeenCalledWith(hit);
    expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
  });

  describe("keyboard", () => {
    it("labels the shortcut per platform", () => {
      const { unmount } = render(
        <RoomSearchPanel
          roomId="550e8400-e29b-41d4-a716-446655440000"
          labels={labels}
          onJumpToMessage={vi.fn()}
        />,
      );

      expect(screen.getByText("⌘F")).toBeInTheDocument();
      expect(screen.getByTestId("room-search-input")).toHaveAttribute(
        "aria-keyshortcuts",
        "Meta+F",
      );

      unmount();
      platform.isApple = false;
      renderPanel();

      expect(screen.getByText("Ctrl+F")).toBeInTheDocument();
      expect(screen.getByTestId("room-search-input")).toHaveAttribute(
        "aria-keyshortcuts",
        "Control+F",
      );
    });

    it("focuses the field from the host shortcut", async () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true });

      await waitFor(() => {
        expect(screen.getByTestId("room-search-input")).toHaveFocus();
      });
      expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
    });

    it("ignores the foreign modifier for the platform", () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", ctrlKey: true });

      expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
    });

    it("uses Ctrl on Windows and Linux", async () => {
      platform.isApple = false;
      renderPanel();

      fireEvent.keyDown(window, { key: "f", ctrlKey: true });

      await waitFor(() => {
        expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
      });
    });

    it("leaves find-in-page alone on a second press inside the field", async () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true });
      await waitFor(() => {
        expect(screen.getByTestId("room-search-input")).toHaveFocus();
      });

      const secondPress = new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(secondPress);

      expect(secondPress.defaultPrevented).toBe(false);
    });

    it("moves through results and jumps with Enter", async () => {
      const newer = message({
        id: "550e8400-e29b-41d4-a716-446655440002",
        content: "Newer budget",
      });
      const older = message({
        id: "550e8400-e29b-41d4-a716-446655440001",
        content: "Older budget",
      });
      getChatRoomMessagesMock.mockResolvedValue({ data: [newer, older] });
      const onJumpToMessage = renderPanel();

      openSearch();
      typeQuery("budget");
      await screen.findAllByTestId("room-search-result");

      const input = screen.getByTestId("room-search-input");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onJumpToMessage).toHaveBeenCalledWith(older);
    });

    it("closes on Escape and keeps focus on the field", async () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true });
      await waitFor(() => {
        expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
      });

      fireEvent.keyDown(screen.getByTestId("room-search-input"), {
        key: "Escape",
      });

      expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("room-search-input")).toHaveFocus();
    });

    it("reopens from the shortcut after Escape, with the field still focused", async () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true });
      await waitFor(() => {
        expect(screen.getByTestId("room-search-input")).toHaveFocus();
      });

      fireEvent.keyDown(screen.getByTestId("room-search-input"), {
        key: "Escape",
      });
      expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("room-search-input")).toHaveFocus();

      const reopen = new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(reopen);

      expect(reopen.defaultPrevented).toBe(true);
      await waitFor(() => {
        expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
      });
    });

    it("ignores an auto-repeating shortcut press", () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true, repeat: true });

      expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
    });

    it("clears the query on Escape, wherever focus is", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      await screen.findByTestId("room-search-result");

      // Radix handles Escape on the layer, so focus placement must not matter.
      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("room-search-input")).toHaveValue("");
    });

    it("keeps the query but drops the hits when a result closes it", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("room-search-input")).toHaveValue("budget");
      expect(screen.queryAllByTestId("room-search-result")).toHaveLength(0);
    });

    it("does not paint the previous hits when it reopens", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });

      openSearch();

      // Assert the surface is actually back, or the "no results" check below
      // would pass simply because the whole subtree is unmounted.
      expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
      expect(screen.queryAllByTestId("room-search-result")).toHaveLength(0);
      expect(screen.queryByTestId("room-search-empty")).not.toBeInTheDocument();
    });

    it("clears the query with Escape after the surface has closed", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("room-search-input")).toHaveValue("budget");

      // The dismissable layer is gone with the surface, so the field has to
      // answer Escape itself.
      fireEvent.keyDown(screen.getByTestId("room-search-input"), {
        key: "Escape",
      });

      expect(screen.getByTestId("room-search-input")).toHaveValue("");
    });

    it("leaves focus where the user clicked after an outside dismissal", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      await screen.findByTestId("room-search-result");

      const elsewhere = document.createElement("input");
      document.body.append(elsewhere);
      elsewhere.focus();
      fireEvent.focusIn(elsewhere);

      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });
      expect(elsewhere).toHaveFocus();
      elsewhere.remove();
    });

    it("does not jump from Enter while the surface is closed", async () => {
      const onJumpToMessage = renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));
      onJumpToMessage.mockClear();

      fireEvent.keyDown(screen.getByTestId("room-search-input"), {
        key: "Enter",
      });

      expect(onJumpToMessage).not.toHaveBeenCalled();
    });

    it("reopens with ArrowDown after a close", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("room-search-panel"),
        ).not.toBeInTheDocument();
      });

      fireEvent.keyDown(screen.getByTestId("room-search-input"), {
        key: "ArrowDown",
      });

      expect(screen.getByTestId("room-search-panel")).toBeInTheDocument();
    });

    it("returns focus to the field after a hit is selected", async () => {
      getChatRoomMessagesMock.mockResolvedValue({ data: [message()] });
      renderPanel();

      openSearch();
      typeQuery("budget");
      fireEvent.click(await screen.findByTestId("room-search-result"));

      await waitFor(() => {
        expect(screen.getByTestId("room-search-input")).toHaveFocus();
      });
    });
  });

  describe("mobile", () => {
    beforeEach(() => {
      platform.isMobile = true;
    });

    it("collapses to the icon trigger and hides the shortcut", () => {
      renderPanel();

      expect(screen.getByTestId("room-search-trigger")).toBeInTheDocument();
      expect(screen.queryByTestId("room-search-input")).not.toBeInTheDocument();
      expect(screen.queryByText("⌘F")).not.toBeInTheDocument();
    });

    it("does not bind the host shortcut", () => {
      renderPanel();

      fireEvent.keyDown(window, { key: "f", metaKey: true });

      expect(screen.queryByTestId("room-search-panel")).not.toBeInTheDocument();
    });

    it("searches from the field inside the popover", async () => {
      renderPanel();

      openSearch();
      typeQuery("budget");

      expect(await screen.findByTestId("room-search-result")).toHaveTextContent(
        "Hello budget review",
      );
    });
  });
});
