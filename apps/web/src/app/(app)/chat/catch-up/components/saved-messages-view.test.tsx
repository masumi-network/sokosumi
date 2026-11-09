import type {
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

const { unsaveMock, listMock, toastMock } = vi.hoisted(() => ({
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
  useLiveChatRooms: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const design = makeRoom({ id: "room-design", name: "design" });

function saved(id: string, content: string): ChatSavedMessageListItem {
  const message: ChatRoomMessage = {
    id,
    roomId: "room-design",
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

function renderView(
  initialPage: Parameters<typeof SavedMessagesView>[0]["initialPage"],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SavedMessagesView
        initialPage={initialPage}
        initialRooms={[design]}
        currentUserId="user-1"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
