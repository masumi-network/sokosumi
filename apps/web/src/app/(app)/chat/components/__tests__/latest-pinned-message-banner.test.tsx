import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatRoomMessage,
  ChatRoomPinnedMessageListItem,
} from "@/lib/clients/generated/core";
import {
  LATEST_PINNED_FETCH_LIMIT,
  LatestPinnedMessageBanner,
} from "../latest-pinned-message-banner";

const listPinnedMessagesAction = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listPinnedMessagesAction: (...args: unknown[]) =>
    listPinnedMessagesAction(...args),
}));

function message(id: string, content: string, name = "Ada"): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name,
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

function pinItem(
  overrides: Partial<ChatRoomPinnedMessageListItem> = {},
): ChatRoomPinnedMessageListItem {
  return {
    messageId: "msg-latest",
    pinnedAt: new Date("2026-08-26T15:00:00.000Z"),
    pinnedBy: { id: "user-1", name: "Ada" },
    message: message("msg-latest", "Don't freeze Friday"),
    ...overrides,
  };
}

const labels = {
  latest: "Latest pin",
  jumpToLatest: (author: string) => `Jump to pinned message from ${author}`,
  viewAll: "View all pinned messages",
  count: (count: number) => `${count} pinned`,
  couldNotLoad: "Message could not be loaded",
};

function createBannerQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderBanner(
  overrides: Partial<Parameters<typeof LatestPinnedMessageBanner>[0]> = {},
) {
  const onJump = vi.fn();
  const onOpenAll = vi.fn();
  const onIdsLoaded = vi.fn();
  const queryClient = createBannerQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const result = render(
    <LatestPinnedMessageBanner
      roomId="room-channel"
      listGeneration={0}
      labels={labels}
      onJump={onJump}
      onOpenAll={onOpenAll}
      onIdsLoaded={onIdsLoaded}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { ...result, onJump, onOpenAll, onIdsLoaded };
}

describe("LatestPinnedMessageBanner", () => {
  beforeEach(() => {
    listPinnedMessagesAction.mockReset();
  });

  it("renders the newest pin under the header after load", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: {
        items: [pinItem(), pinItem({ messageId: "msg-old" })],
        nextCursor: null,
        total: 2,
      },
    });

    renderBanner();

    expect(listPinnedMessagesAction).toHaveBeenCalledWith("room-channel", {
      limit: LATEST_PINNED_FETCH_LIMIT,
    });
    const banner = await screen.findByTestId("latest-pinned-message");
    expect(banner).toHaveTextContent("Latest pin");
    expect(banner).toHaveTextContent("Ada");
    expect(banner).toHaveTextContent("Don't freeze Friday");
    expect(
      screen.getByRole("button", {
        name: "Jump to pinned message from Ada",
      }),
    ).toBeTruthy();
  });

  it("renders persist mention tokens as @all chips in the preview", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: {
        items: [
          pinItem({
            message: message("msg-latest", "@all:all Okay, so"),
          }),
        ],
        nextCursor: null,
        total: 1,
      },
    });

    renderBanner();

    const jump = await screen.findByRole("button", {
      name: "Jump to pinned message from Ada",
    });
    expect(jump).toHaveTextContent("@all");
    expect(jump).toHaveTextContent("Okay, so");
    expect(jump).not.toHaveTextContent("@all:all");
    expect(jump.querySelector(".whitespace-nowrap")).toHaveTextContent("@all");
  });

  it("keeps a long pinned message to a single preview line", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: {
        items: [
          pinItem({
            message: message(
              "msg-latest",
              [
                "@all:all Okay, so I have another big update for today.",
                "",
                "- Sokosumi, an AI platform for Marketing.",
                "- Masumi, an Agent Wallet.",
              ].join("\n"),
            ),
          }),
        ],
        nextCursor: null,
        total: 1,
      },
    });

    renderBanner();

    const jump = await screen.findByRole("button", {
      name: "Jump to pinned message from Ada",
    });
    const snippet = jump.querySelector(
      "[data-testid='latest-pinned-message-snippet']",
    );
    expect(snippet).toBeTruthy();
    expect(snippet).toHaveClass("truncate");
    expect(jump.querySelector("ul, ol, li")).toBeNull();
    expect(jump).toHaveTextContent("@all");
    expect(jump).not.toHaveTextContent("@all:all");
    expect(jump).toHaveTextContent("Sokosumi");
  });

  it("jumps to the latest pin on click", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: { items: [pinItem()], nextCursor: null, total: 1 },
    });
    const user = userEvent.setup();
    const { onJump, onOpenAll } = renderBanner();

    await user.click(
      await screen.findByRole("button", {
        name: "Jump to pinned message from Ada",
      }),
    );

    expect(onJump).toHaveBeenCalledWith("msg-latest");
    expect(onOpenAll).not.toHaveBeenCalled();
  });

  it("opens the full pin list from the count when more than one pin exists", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: { items: [pinItem()], nextCursor: "next", total: 3 },
    });
    const user = userEvent.setup();
    const { onJump, onOpenAll, onIdsLoaded } = renderBanner();

    const count = await screen.findByRole("button", {
      name: "View all pinned messages",
    });
    expect(count).toHaveTextContent("3 pinned");
    await user.click(count);

    expect(onOpenAll).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
    expect(onIdsLoaded).toHaveBeenCalledWith(["msg-latest"]);
  });

  it("keeps the current pin visible while a later pin list refetch is in flight", async () => {
    let resolveRefetch: ((value: unknown) => void) | undefined;
    listPinnedMessagesAction
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [pinItem()], nextCursor: null, total: 1 },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    const { rerender, onJump, onOpenAll, onIdsLoaded } = renderBanner();
    expect(await screen.findByTestId("latest-pinned-message")).toBeTruthy();

    rerender(
      <LatestPinnedMessageBanner
        roomId="room-channel"
        listGeneration={1}
        labels={labels}
        onJump={onJump}
        onOpenAll={onOpenAll}
        onIdsLoaded={onIdsLoaded}
      />,
    );

    expect(screen.getByTestId("latest-pinned-message")).toHaveTextContent(
      "Don't freeze Friday",
    );
    expect(screen.queryByTestId("latest-pinned-message-loading")).toBeNull();
    resolveRefetch?.({
      ok: true,
      value: { items: [pinItem()], nextCursor: null, total: 1 },
    });
    await waitFor(() => {
      expect(listPinnedMessagesAction).toHaveBeenCalledTimes(2);
    });
  });

  it("hides the banner when a later same-room fetch fails", async () => {
    listPinnedMessagesAction
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [pinItem()], nextCursor: null, total: 1 },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { message: "Could not load pinned messages" },
      });

    const { rerender, onJump, onOpenAll, onIdsLoaded } = renderBanner();
    expect(await screen.findByTestId("latest-pinned-message")).toBeTruthy();

    rerender(
      <LatestPinnedMessageBanner
        roomId="room-channel"
        listGeneration={1}
        labels={labels}
        onJump={onJump}
        onOpenAll={onOpenAll}
        onIdsLoaded={onIdsLoaded}
      />,
    );

    await waitFor(() => {
      expect(listPinnedMessagesAction).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("latest-pinned-message")).toBeNull();
    });
  });

  it("does not keep the previous room's pin when the next room fails to load", async () => {
    listPinnedMessagesAction
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [pinItem()], nextCursor: null, total: 1 },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { message: "Could not load pinned messages" },
      });

    const { rerender, onJump, onOpenAll, onIdsLoaded } = renderBanner();
    expect(await screen.findByTestId("latest-pinned-message")).toBeTruthy();

    rerender(
      <LatestPinnedMessageBanner
        roomId="room-other"
        listGeneration={0}
        labels={labels}
        onJump={onJump}
        onOpenAll={onOpenAll}
        onIdsLoaded={onIdsLoaded}
      />,
    );

    await waitFor(() => {
      expect(listPinnedMessagesAction).toHaveBeenCalledWith("room-other", {
        limit: LATEST_PINNED_FETCH_LIMIT,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("latest-pinned-message")).toBeNull();
    });
  });

  it("hides when the channel has no pins", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: { items: [], nextCursor: null, total: 0 },
    });

    renderBanner();

    await waitFor(() => {
      expect(listPinnedMessagesAction).toHaveBeenCalled();
      expect(screen.queryByTestId("latest-pinned-message-loading")).toBeNull();
    });
    expect(screen.queryByTestId("latest-pinned-message")).toBeNull();
  });

  it("skips a deleted newest pin in favor of the next loadable message", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: {
        items: [
          pinItem({ message: null, messageId: "msg-deleted" }),
          pinItem({
            messageId: "msg-ok",
            message: message("msg-ok", "Still here"),
          }),
        ],
        nextCursor: null,
        total: 2,
      },
    });

    renderBanner();

    const banner = await screen.findByTestId("latest-pinned-message");
    expect(banner).toHaveTextContent("Still here");
    expect(banner).not.toHaveTextContent("Message could not be loaded");
  });

  it("shows a deleted latest pin as unloadable without jumping", async () => {
    listPinnedMessagesAction.mockResolvedValue({
      ok: true,
      value: {
        items: [pinItem({ message: null, messageId: "msg-deleted" })],
        nextCursor: null,
        total: 1,
      },
    });
    const user = userEvent.setup();
    const { onJump, onOpenAll } = renderBanner();

    await user.click(await screen.findByText("Message could not be loaded"));
    expect(onJump).not.toHaveBeenCalled();
    expect(onOpenAll).toHaveBeenCalledTimes(1);
  });
});
