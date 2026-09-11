import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("./room-message-row", () => ({
  ChannelMessageText: ({ content }: { content: string }) => (
    <span>{content}</span>
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
      onIdsLoaded={vi.fn()}
    />,
  );
  return { onClose };
}

describe("PinnedMessagesPanel", () => {
  beforeEach(() => {
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
});
