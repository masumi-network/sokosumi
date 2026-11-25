import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import {
  listThreadMessagesAction,
  markThreadReadAction,
  mockHeaderRoomSlotHost,
  mockIsMobileMedia,
  renderWithQueryClient,
  roomsClientBaseProps,
} from "./rooms-client-harness";

const { composerFocus } = vi.hoisted(() => ({ composerFocus: vi.fn() }));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: composerFocus,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

// The reply bar, else the row's screen-reader-only actions trigger, is where
// a thread is opened from, so it is where focus goes back to. A row that is
// no longer in the transcript ("gone") renders its open button outside any
// message row.
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onOpenThread,
  }: {
    message: ChatRoomMessage;
    onOpenThread?: (message: ChatRoomMessage) => void;
  }) => {
    const open = (
      <button
        type="button"
        data-testid={`open-thread-${message.id}`}
        onClick={() => onOpenThread?.(message)}
      >
        Open thread
      </button>
    );
    if (message.id === "gone") {
      return open;
    }
    return (
      <article data-message-id={message.id}>
        {open}
        {message.threadReplyCount > 0 ? (
          <button
            type="button"
            data-slot="thread-reply-bar"
            onClick={() => onOpenThread?.(message)}
          >
            {message.threadReplyCount} replies
          </button>
        ) : null}
        <button type="button" data-message-actions-trigger>
          Message actions {message.id}
        </button>
      </article>
    );
  },
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

// Each pane holds an editor and a nested layer that handles Escape itself,
// so the tests can press Escape from either and see the pane stay.
function PaneBody({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <aside>
      <button type="button" onClick={onClose}>
        Close {name}
      </button>
      <textarea aria-label={`${name} reply`} />
      {/* The composer: an editor that leaves an idle Escape alone. */}
      <div
        role="textbox"
        aria-label={`${name} composer`}
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
      />
      <button
        type="button"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}
      >
        {name} menu
      </button>
    </aside>
  );
}

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({ onClose }: { onClose: () => void }) => (
    <PaneBody name="thread" onClose={onClose} />
  ),
}));

vi.mock(
  "@/app/chat/components/pinned-messages-panel",
  async (importActual) => ({
    ...(await importActual<
      typeof import("@/app/chat/components/pinned-messages-panel")
    >()),
    PinnedMessagesPanel: ({ onClose }: { onClose: () => void }) => (
      <PaneBody name="pins" onClose={onClose} />
    ),
  }),
);

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => null,
}));

function message(id: string, threadReplyCount: number): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content: `Message ${id}`,
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount,
    threadLastReplyAt:
      threadReplyCount > 0 ? new Date("2026-07-01T12:02:00.000Z") : null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

const baseProps = roomsClientBaseProps({
  messages: [
    message("with-replies", 2),
    message("no-replies", 0),
    message("gone", 0),
  ],
});

describe("RoomsClient thread close focus", () => {
  beforeEach(() => {
    composerFocus.mockReset();
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [], nextCursor: null },
    });
  });

  it("returns focus to the thread's reply bar, not the page", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "2 replies" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close thread" }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "2 replies" }),
      );
    });
    expect(composerFocus).not.toHaveBeenCalled();
  });

  it("returns focus to the row's actions trigger when there is no reply bar", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-no-replies"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close thread" }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Message actions no-replies" }),
      );
    });
    expect(composerFocus).not.toHaveBeenCalled();
  });

  it("falls back to the composer when the row is gone", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-gone"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close thread" }),
    );

    await waitFor(() => {
      expect(composerFocus).toHaveBeenCalled();
    });
  });
});

describe("RoomsClient Escape closes the open pane", () => {
  beforeEach(() => {
    composerFocus.mockReset();
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [], nextCursor: null },
    });
  });

  it("closes the thread from inside and returns focus to its reply bar", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "2 replies" }));
    fireEvent.keyDown(
      await screen.findByRole("button", { name: "Close thread" }),
      { key: "Escape" },
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "2 replies" }),
      );
    });
    expect(screen.queryByRole("button", { name: "Close thread" })).toBeNull();
  });

  it.each([
    [
      "the thread",
      () => screen.getByRole("button", { name: "2 replies" }),
      "Close thread",
    ],
    [
      "Pinned",
      () => screen.getByTestId("pinned-messages-trigger"),
      "Close pins",
    ],
  ])(
    "closes %s on Escape straight from the opener, which keeps focus",
    async (_, getOpener, closeName) => {
      renderWithQueryClient(<RoomsClient {...baseProps} />);
      const opener = getOpener();
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole("button", { name: closeName });
      fireEvent.keyDown(opener, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: closeName })).toBeNull();
      });
      expect(document.activeElement).toBe(opener);
      expect(composerFocus).not.toHaveBeenCalled();
    },
  );

  it("closes Pinned from inside and returns focus to the button that opened it", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    const opener = screen.getByTestId("pinned-messages-trigger");
    opener.focus();
    fireEvent.click(opener);
    const close = await screen.findByRole("button", { name: "Close pins" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });

    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
    expect(close.isConnected).toBe(false);
  });

  it("falls back to the composer when nothing had focus at open", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByTestId("pinned-messages-trigger"));
    fireEvent.keyDown(
      await screen.findByRole("button", { name: "Close pins" }),
      { key: "Escape" },
    );

    await waitFor(() => {
      expect(composerFocus).toHaveBeenCalled();
    });
  });

  it("falls back to the composer when the opener can no longer take focus", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    const opener = screen.getByTestId("pinned-messages-trigger");
    opener.focus();
    fireEvent.click(opener);
    const close = await screen.findByRole("button", { name: "Close pins" });
    close.focus();
    // Below md the desktop button is hidden: still in the page, not focusable.
    opener.setAttribute("disabled", "");
    fireEvent.keyDown(close, { key: "Escape" });

    await waitFor(() => {
      expect(composerFocus).toHaveBeenCalled();
    });
  });

  it("closes the thread from an idle composer", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "2 replies" }));
    const composer = await screen.findByRole("textbox", {
      name: "thread composer",
    });
    composer.focus();
    fireEvent.keyDown(composer, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close thread" })).toBeNull();
    });
  });

  it.each([
    ["a form field", "thread reply", "textbox"],
    ["a nested layer", "thread menu", "button"],
  ] as const)(
    "leaves the pane open when %s takes Escape",
    async (_, name, role) => {
      renderWithQueryClient(<RoomsClient {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: "2 replies" }));
      fireEvent.keyDown(await screen.findByRole(role, { name }), {
        key: "Escape",
      });

      expect(screen.getByRole("button", { name: "Close thread" })).toBeTruthy();
    },
  );

  it("closes Pinned on Escape from the mobile header, portaled out of the room", async () => {
    mockIsMobileMedia.mockReturnValue(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    mockHeaderRoomSlotHost.mockReturnValue(host);
    try {
      renderWithQueryClient(<RoomsClient {...baseProps} />);
      const opener = await waitFor(() => {
        const trigger = host.querySelector<HTMLElement>(
          "[data-testid='pinned-messages-trigger']",
        );
        expect(trigger).not.toBeNull();
        return trigger as HTMLElement;
      });
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole("button", { name: "Close pins" });
      fireEvent.keyDown(opener, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Close pins" })).toBeNull();
      });
      expect(document.activeElement).toBe(opener);
    } finally {
      host.remove();
    }
  });

  it("leaves Escape alone while no pane is open", () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    const bar = screen.getByRole("button", { name: "2 replies" });
    bar.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    bar.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
