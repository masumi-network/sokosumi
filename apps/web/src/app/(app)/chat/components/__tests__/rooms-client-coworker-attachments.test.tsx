import "./rooms-client-harness";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import { TestQueryProvider } from "@/test/query-provider";
import type { RoomComposerHandle } from "../room-composer";
import { renderRoomsClient } from "./rooms-client-harness";

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => (
    <button type="button" data-testid="room-search-trigger" />
  ),
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: ({
    onToggle,
    isOpen,
  }: {
    onToggle: () => void;
    isOpen: boolean;
  }) => (
    <button
      type="button"
      data-testid="unread-threads-trigger"
      aria-expanded={isOpen}
      onClick={onToggle}
    />
  ),
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({
    children,
    enabled,
  }: {
    children: ReactNode;
    enabled: boolean;
  }) => (
    <div data-testid="room-file-drop-zone" data-enabled={String(enabled)}>
      {children}
    </div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    allowAttachments,
  }: {
    ref?: Ref<RoomComposerHandle>;
    allowAttachments?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-allow-attachments={String(allowAttachments ?? true)}
      />
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onOpenThread,
  }: {
    message: ChatRoomMessage;
    onOpenThread?: (message: ChatRoomMessage) => void;
  }) => (
    <button
      type="button"
      data-testid={`open-thread-${message.id}`}
      onClick={() => onOpenThread?.(message)}
    >
      {message.content}
    </button>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({ allowAttachments }: { allowAttachments?: boolean }) => (
    <aside
      data-testid="thread-panel"
      data-allow-attachments={String(allowAttachments ?? true)}
    />
  ),
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));

function coworkerDirectRoom(): ChatRoom {
  return {
    id: "room-coworker",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Ada, Eve",
    slug: "direct",
    kind: "direct",
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "private",
    createdByUserId: "user-1",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      {
        id: "user-1",
        name: "Ada",
        email: "user-1@example.com",
        image: null,
        presence: "offline",
      },
    ],
    coworkerMembers: [
      {
        id: "coworker-1",
        name: "Eve",
        slug: "eve",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
    sokoBotMembers: [],
  };
}

function parentMessage(): ChatRoomMessage {
  return {
    id: "msg-parent",
    roomId: "room-coworker",
    parentMessageId: null,
    content: "hello",
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
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
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

function renderRoom(room: ChatRoom) {
  return renderRoomsClient(
    {
      rooms: [room],
      selectedRoomId: room.id,
      messages: [parentMessage()],
    },
    { wrapper: TestQueryProvider },
  );
}

// Regression: coworker DMs hid the attach button and drop zone, so users
// could not upload pictures when chatting with an agent.
describe("RoomsClient coworker DM attachments", () => {
  it("allows attachments and file drops in a coworker direct room", () => {
    renderRoom(coworkerDirectRoom());
    expect(screen.getByTestId("room-session-composer")).toHaveAttribute(
      "data-allow-attachments",
      "true",
    );
    expect(screen.getByTestId("room-file-drop-zone")).toHaveAttribute(
      "data-enabled",
      "true",
    );
  });

  it("allows attachments in a coworker direct room thread", async () => {
    renderRoom(coworkerDirectRoom());
    fireEvent.click(screen.getByTestId("open-thread-msg-parent"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-allow-attachments",
        "true",
      );
    });
  });
});
