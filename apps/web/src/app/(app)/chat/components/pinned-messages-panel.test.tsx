import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatRoomMessage,
  ChatRoomPinnedMessageListItem,
} from "@/lib/clients/generated/core";
import { PinnedMessagesPanel } from "./pinned-messages-panel";

const listPinnedMessagesActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listPinnedMessagesAction: (...args: unknown[]) =>
    listPinnedMessagesActionMock(...args),
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const { openAttachmentMock } = vi.hoisted(() => ({
  openAttachmentMock: vi.fn(),
}));

// The real body carries attachment tiles, links and players; stand in for
// one of each kind of control.
vi.mock("./room-message-row", () => ({
  ChannelMessageText: ({ content }: { content: string }) => (
    <span>
      {content}
      <button type="button" onClick={openAttachmentMock}>
        View document budget.pdf
      </button>
      <a href="https://blob.example.com/budget.xlsx">budget.xlsx</a>
    </span>
  ),
}));

const labels = {
  title: "Pinned Messages",
  close: "Close pinned messages",
  empty: "No pinned messages yet",
  loading: "Loading pinned messages…",
  error: "Could not load pinned messages",
  couldNotLoad: "Message could not be loaded",
  unpin: "Unpin message",
  loadOlder: "Load older",
  jumping: "Opening message…",
};

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";

function pinnedMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Budget review",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    metadata: null,
    threadReplyCount: 0,
    threadLastReplyAt: null,
    mentions: [],
    quote: null,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

function pinnedItem(): ChatRoomPinnedMessageListItem {
  return {
    messageId: MESSAGE_ID,
    pinnedAt: new Date("2026-08-01T00:00:00.000Z"),
    pinnedBy: { id: "user_1", name: "Ada" },
    message: pinnedMessage(),
  };
}

function renderPanel(onJump: (messageId: string) => Promise<boolean>) {
  const onClose = vi.fn();
  render(
    <PinnedMessagesPanel
      roomId={ROOM_ID}
      labels={labels}
      listGeneration={0}
      coworkersById={new Map()}
      coworkersBySlug={new Map()}
      usersById={new Map()}
      usersBySlug={new Map()}
      channelLinks={[]}
      currentUserId="user_1"
      canOpenHumanDirect={false}
      onOpenDirectMessage={vi.fn()}
      openingDirectParticipantKey={null}
      onClose={onClose}
      onJump={onJump}
      onUnpin={vi.fn(async () => true)}
    />,
  );
  return { onClose };
}

describe("PinnedMessagesPanel", () => {
  beforeEach(() => {
    openAttachmentMock.mockReset();
    listPinnedMessagesActionMock.mockReset();
    listPinnedMessagesActionMock.mockResolvedValue({
      ok: true,
      value: { items: [pinnedItem()], nextCursor: null },
    });
  });

  it("marks the tapped row while the jump runs, then closes once it landed", async () => {
    let land: (landed: boolean) => void = () => {};
    const onJump = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          land = resolve;
        }),
    );
    const { onClose } = renderPanel(onJump);

    fireEvent.click(await screen.findByRole("button", { name: /Ada/ }));

    expect(onJump).toHaveBeenCalledExactlyOnceWith(MESSAGE_ID);
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText(labels.jumping)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    land(true);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("stays open, unmarked, when the jump gave up", async () => {
    const { onClose } = renderPanel(vi.fn(async () => false));

    fireEvent.click(await screen.findByRole("button", { name: /Ada/ }));

    await waitFor(() => {
      expect(screen.queryByText(labels.jumping)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the body's controls outside the jump button", async () => {
    renderPanel(vi.fn(async () => true));

    const jump = await screen.findByRole("button", { name: /Ada/ });
    const body = screen.getByTestId("pinned-message-body");

    expect(jump.querySelector("a, button, audio, video")).toBeNull();
    expect(jump).not.toContainElement(body);
    expect(jump).toHaveAccessibleDescription(/Budget review/);
  });

  it("opens an attachment without jumping", async () => {
    const onJump = vi.fn(async () => true);
    renderPanel(onJump);

    fireEvent.click(
      await screen.findByRole("button", { name: "View document budget.pdf" }),
    );
    fireEvent.click(screen.getByRole("link", { name: "budget.xlsx" }));

    expect(openAttachmentMock).toHaveBeenCalledOnce();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("lays the body over the row's jump target, letting only its controls take clicks", async () => {
    renderPanel(vi.fn(async () => true));

    const jump = await screen.findByRole("button", { name: /Ada/ });
    // The button's ::after stretches over the row; jsdom has no layout, so
    // pin the classes that make the row clickable around the body.
    expect(jump).toHaveClass("after:absolute", "after:inset-0");
    expect(screen.getByTestId("pinned-message-body")).toHaveClass(
      "pointer-events-none",
      "relative",
      "z-[1]",
      "[&_:is(a,button,audio,video,[role=button],[data-slot=hover-card-trigger])]:pointer-events-auto",
    );
  });

  it("jumps from the keyboard", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn(async () => true);
    renderPanel(onJump);

    await screen.findByRole("button", { name: /Ada/ });
    await user.tab(); // close
    await user.tab();
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onJump).toHaveBeenCalledExactlyOnceWith(MESSAGE_ID);
  });
});
