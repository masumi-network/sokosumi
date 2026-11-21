import type { ChatRoomMessage } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ getChatRoomMessages: vi.fn() }));
vi.mock("@/lib/clients/core.browser.client", () => ({ coreClient: core }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "18 Nov" }),
}));

import { RoomLinksPopover } from "./room-links-popover";

function message(id: string, content: string): ChatRoomMessage {
  return {
    id,
    content,
    createdAt: "2026-11-18T10:00:00.000Z",
    sender: { type: "user", user: { name: "Ada" } },
  } as unknown as ChatRoomMessage;
}

function page(messages: ChatRoomMessage[], nextCursor: string | null) {
  return { data: messages, meta: { pagination: { nextCursor } } };
}

const onJump = vi.fn();

function renderLinks() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RoomLinksPopover roomId="room-1" onJumpToMessage={onJump} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoomLinksPopover", () => {
  it("lists the room's links newest first and jumps to a link's message", async () => {
    const newest = message("m2", "Plan: https://example.com/plan");
    core.getChatRoomMessages.mockResolvedValueOnce(
      page([newest, message("m1", "Older https://old.example.org")], null),
    );
    const user = userEvent.setup();
    renderLinks();

    await user.click(screen.getByRole("button", { name: "open" }));

    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/plan",
      "https://old.example.org",
    ]);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(core.getChatRoomMessages).toHaveBeenCalledWith("room-1", {
      q: "http",
      limit: 30,
      cursor: undefined,
    });

    await user.click(screen.getAllByRole("button", { name: "showInChat" })[0]!);
    expect(onJump).toHaveBeenCalledWith(newest);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("loads older links from the next page", async () => {
    core.getChatRoomMessages
      .mockResolvedValueOnce(page([message("m3", "no link, just http")], "m3"))
      .mockResolvedValueOnce(
        page([message("m1", "https://old.example.org")], null),
      );
    const user = userEvent.setup();
    renderLinks();

    await user.click(screen.getByRole("button", { name: "open" }));
    // A page with no links still offers older ones instead of saying none.
    await user.click(await screen.findByRole("button", { name: "loadOlder" }));

    expect(await screen.findByRole("link")).toHaveAttribute(
      "href",
      "https://old.example.org",
    );
    expect(core.getChatRoomMessages).toHaveBeenLastCalledWith("room-1", {
      q: "http",
      limit: 30,
      cursor: "m3",
    });
    expect(screen.queryByRole("button", { name: "loadOlder" })).toBeNull();
  });

  it("says so when the room has no links", async () => {
    core.getChatRoomMessages.mockResolvedValueOnce(page([], null));
    const user = userEvent.setup();
    renderLinks();

    await user.click(screen.getByRole("button", { name: "open" }));

    expect(await screen.findByText("empty")).toBeInTheDocument();
  });
});
