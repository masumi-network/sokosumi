import "./rooms-client-harness";
import { act, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import {
  markOrganizationChatRoomReadAction,
  roomsClientBaseProps,
} from "./rooms-client-harness";

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("@/components/chat/room-read-overlay", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/room-read-overlay")
    >();
  const rememberRoomRead = vi.fn();
  const forgetRoomRead = vi.fn();
  return {
    ...actual,
    rememberRoomRead,
    forgetRoomRead,
    beginRoomAttentionChange: (room: ChatRoom, previousRoom?: ChatRoom) => {
      rememberRoomRead(room);
      return actual.beginRoomAttentionChange(room, previousRoom);
    },
    settleRoomAttentionChange: (
      roomId: string,
      token: number,
      room: ChatRoom | null,
    ) => {
      const accepted = actual.settleRoomAttentionChange(roomId, token, room);
      if (accepted) {
        if (room) rememberRoomRead(room);
        else forgetRoomRead(roomId);
      }
      return accepted;
    },
  };
});

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({
    ref,
    focusOnMount,
  }: {
    ref?: Ref<RoomComposerHandle>;
    focusOnMount?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <div
        data-testid="room-session-composer"
        data-focus-on-mount={String(Boolean(focusOnMount))}
      />
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div data-testid="chat-message-row" data-message-id={message.id}>
      {message.quote ? `quote:${message.quote.authorName}` : message.content}
    </div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({
    membersLoadFailed,
    members,
    coworkers,
    children,
  }: {
    membersLoadFailed?: boolean;
    members?: unknown[];
    coworkers?: unknown[];
    children?: ReactNode;
  }) => (
    <>
      {children}
      <div
        data-testid="edit-channel-dialog-probe"
        data-members-load-failed={String(Boolean(membersLoadFailed))}
        data-members-count={String(members?.length ?? 0)}
        data-coworkers-count={String(coworkers?.length ?? 0)}
      />
    </>
  ),
}));

function channelRoom(): ChatRoom {
  return {
    id: "room-channel",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "public",
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
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

function sampleMessage(content = "history body"): ChatRoomMessage {
  return {
    id: "msg-real",
    roomId: "room-channel",
    parentMessageId: null,
    content,
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

function selfDirectRoom(): ChatRoom {
  return {
    ...channelRoom(),
    id: "room-self",
    name: "You",
    slug: null,
    kind: "direct",
    isSelfDirect: true,
    isGroupDirect: false,
    groupName: null,
    organizationId: null,
    organizationName: null,
    directKey: "direct:self:user-1",
    discoverability: null,
  };
}

/** Send to yourself writes a quote with no body of its own. */
function savedQuoteMessage(): ChatRoomMessage {
  return {
    ...sampleMessage(""),
    id: "msg-saved-quote",
    roomId: "room-self",
    quote: {
      messageId: "source-message",
      roomId: "room-source",
      authorName: "Bob",
      snippet: "Ship the launch notes",
      attachment: null,
    },
  };
}

const baseProps = roomsClientBaseProps();

describe("RoomsClient Self Direct transcript", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (roomId: string) => ({
        ok: true as const,
        value: {
          ...selfDirectRoom(),
          id: roomId,
          unreadCount: 0,
          unreadMentionCount: 0,
          markedUnread: false,
        },
      }),
    );
  });

  const selfDirectProps = {
    ...baseProps,
    rooms: [selfDirectRoom()],
    selectedRoomId: "room-self",
  };

  it("shows a quote sent to yourself in the server-rendered history", () => {
    render(
      <RoomsClient {...selfDirectProps} messages={[savedQuoteMessage()]} />,
    );

    expect(screen.getByTestId("chat-message-row")).toHaveAttribute(
      "data-message-id",
      "msg-saved-quote",
    );
  });

  it("shows a quote sent to yourself in hydrated history", async () => {
    let resolvePage!: (page: {
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const messagesPromise = new Promise<{
      messages: ChatRoomMessage[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolvePage = resolve;
    });

    render(
      <RoomsClient {...selfDirectProps} messagesPromise={messagesPromise} />,
    );

    await act(async () => {
      resolvePage({
        messages: [savedQuoteMessage()],
        nextCursor: null,
        failed: false,
      });
      await messagesPromise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("room-message-list-skeleton")).toBeNull();
    });
    expect(screen.getByTestId("chat-message-row")).toHaveTextContent(
      "quote:Bob",
    );
  });
});
