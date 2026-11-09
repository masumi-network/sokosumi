import type {
  ChatRoom,
  ChatRoomMessage,
  ChatSavedMessageListItem,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";

import { SavedMessagesView } from "./saved-messages-view";

const { liveRooms, unsaveMock, listMock, toastMock } = vi.hoisted(() => ({
  liveRooms: { current: null as ChatRoom[] | null },
  unsaveMock: vi.fn(),
  listMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  unsaveRoomMessageAction: unsaveMock,
  listSavedMessagesAction: listMock,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const design = makeRoom({ id: "room-design", name: "design" });
const marketing = makeRoom({ id: "room-marketing", name: "marketing" });
const direct = makeRoom({ id: "room-direct", name: "Ada", kind: "direct" });

function saved(
  id: string,
  content: string,
  roomId = "room-design",
): ChatSavedMessageListItem {
  const message: ChatRoomMessage = {
    id,
    roomId,
    parentMessageId: null,
    content,
    createdAt: new Date("2026-11-08T09:00:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-2",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
  return {
    messageId: id,
    savedAt: new Date("2026-11-09T09:00:00.000Z"),
    message,
  };
}

type Page = Parameters<typeof SavedMessagesView>[0]["initialPage"];

function view(initialPage: Page, initialRooms: ChatRoom[] = [design]) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SavedMessagesView
        initialPage={initialPage}
        initialRooms={initialRooms}
        currentUserId="user-1"
      />
    </NextIntlClientProvider>
  );
}

function renderView(initialPage: Page) {
  return render(view(initialPage));
}

beforeEach(() => {
  vi.clearAllMocks();
  liveRooms.current = null;
});

describe("SavedMessagesView", () => {
  it("links each saved message to its place in the room", () => {
    renderView({ items: [saved("m-1", "Ship it Friday")], nextCursor: null });

    const link = screen.getByRole("link", { name: /Ship it Friday/ });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("room-design"),
    );
    expect(link).toHaveAttribute("href", expect.stringContaining("m-1"));
    expect(link).toHaveTextContent("Ada");
    expect(link).toHaveTextContent("#design");
  });

  it("removes a message from the list", async () => {
    const user = userEvent.setup();
    unsaveMock.mockResolvedValue({ ok: true, value: null });
    renderView({
      items: [saved("m-1", "Ship it Friday"), saved("m-2", "Call Bob")],
      nextCursor: null,
    });

    const row = screen.getByRole("link", { name: /Ship it Friday/ })
      .parentElement as HTMLElement;
    await user.click(
      within(row).getByRole("button", { name: "Remove from saved" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Ship it Friday/ }),
      ).not.toBeInTheDocument();
    });
    expect(unsaveMock).toHaveBeenCalledExactlyOnceWith("m-1");
    expect(screen.getByRole("link", { name: /Call Bob/ })).toBeInTheDocument();
  });

  it("keeps the row when removing fails", async () => {
    const user = userEvent.setup();
    unsaveMock.mockResolvedValue({
      ok: false,
      error: { message: "Could not remove the message from Saved." },
    });
    renderView({ items: [saved("m-1", "Ship it Friday")], nextCursor: null });

    await user.click(screen.getByRole("button", { name: "Remove from saved" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    expect(
      screen.getByRole("link", { name: /Ship it Friday/ }),
    ).toBeInTheDocument();
  });

  it("loads older saves", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ok: true,
      value: { items: [saved("m-2", "Older one")], nextCursor: null },
    });
    renderView({ items: [saved("m-1", "Newest")], nextCursor: "cursor-1" });

    await user.click(screen.getByRole("button", { name: "Load older" }));

    expect(
      await screen.findByRole("link", { name: /Older one/ }),
    ).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith("cursor-1");
    expect(
      screen.queryByRole("button", { name: "Load older" }),
    ).not.toBeInTheDocument();
  });

  it("explains how to save when the list is empty", () => {
    renderView({ items: [], nextCursor: null });
    expect(screen.getByTestId("saved-messages-empty")).toHaveTextContent(
      "Save for later",
    );
  });

  it("says the list could not load", () => {
    renderView(null);
    expect(
      screen.getByText("Could not load saved messages."),
    ).toBeInTheDocument();
  });

  it("replaces the list and its cursor when the workspace changes", async () => {
    const user = userEvent.setup();
    liveRooms.current = [design, direct];
    const { rerender } = render(
      view({
        items: [
          saved("m-a", "From workspace A"),
          saved("m-d", "Direct", "room-direct"),
        ],
        nextCursor: "cursor-a",
      }),
    );

    // Workspace B: its own Channel, the same human Direct.
    liveRooms.current = [marketing, direct];
    listMock.mockResolvedValue({
      ok: true,
      value: {
        items: [saved("m-b2", "Older in B", "room-marketing")],
        nextCursor: null,
      },
    });
    rerender(
      view({
        items: [
          saved("m-b", "From workspace B", "room-marketing"),
          saved("m-d", "Direct", "room-direct"),
        ],
        nextCursor: "cursor-b",
      }),
    );

    expect(
      screen.queryByRole("link", { name: /From workspace A/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /From workspace B/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Direct/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load older" }));
    expect(listMock).toHaveBeenCalledExactlyOnceWith("cursor-b");
    expect(
      await screen.findByRole("link", { name: /Older in B/ }),
    ).toBeInTheDocument();
  });

  it("shows a refreshed first page instead of the old content", () => {
    const { rerender } = render(
      view({ items: [saved("m-1", "Before edit")], nextCursor: null }),
    );

    rerender(view({ items: [saved("m-1", "After edit")], nextCursor: null }));

    expect(
      screen.getByRole("link", { name: /After edit/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Before edit/ }),
    ).not.toBeInTheDocument();
  });

  it("drops a row once its room leaves the reader's live rooms", () => {
    liveRooms.current = [design, marketing];
    const { rerender } = render(
      view({
        items: [
          saved("m-1", "Design note"),
          saved("m-2", "Marketing note", "room-marketing"),
        ],
        nextCursor: null,
      }),
    );
    expect(
      screen.getByRole("link", { name: /Marketing note/ }),
    ).toBeInTheDocument();

    liveRooms.current = [design];
    rerender(
      view({
        items: [
          saved("m-1", "Design note"),
          saved("m-2", "Marketing note", "room-marketing"),
        ],
        nextCursor: null,
      }),
    );

    expect(
      screen.queryByRole("link", { name: /Marketing note/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Design note/ }),
    ).toBeInTheDocument();
  });

  it("does not bring the page's rooms back once live rooms are dropped", () => {
    liveRooms.current = [design];
    const page = { items: [saved("m-1", "Design note")], nextCursor: null };
    const { rerender } = render(view(page));

    liveRooms.current = null;
    rerender(view(page));

    expect(
      screen.queryByRole("link", { name: /Design note/ }),
    ).not.toBeInTheDocument();
  });

  it("ignores an older page that lands after the workspace changed", async () => {
    const user = userEvent.setup();
    let resolveOlder: (value: unknown) => void = () => {};
    listMock.mockReturnValue(
      new Promise((resolve) => {
        resolveOlder = resolve;
      }),
    );
    const { rerender } = render(
      view({
        items: [saved("m-a", "From workspace A")],
        nextCursor: "cursor-a",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Load older" }));

    rerender(
      view({ items: [saved("m-b", "From workspace B")], nextCursor: null }),
    );
    resolveOlder({
      ok: true,
      value: { items: [saved("m-a2", "Older in A")], nextCursor: null },
    });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith("cursor-a");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole("link", { name: /Older in A/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /From workspace B/ }),
    ).toBeInTheDocument();
  });
});
