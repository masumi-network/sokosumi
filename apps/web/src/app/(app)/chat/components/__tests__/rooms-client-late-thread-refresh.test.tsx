import "./rooms-client-harness";
import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseCoworkerDirectRoomStreamParams } from "@/app/chat/hooks/use-coworker-direct-room-stream";
import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import {
  coworkerParticipant,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markOrganizationChatRoomReadAction,
  markThreadReadAction,
  readStoredStreamParentMessageIdMock,
  renderWithQueryClient,
  roomsClientBaseProps,
  useCoworkerDirectRoomStreamMock,
  userParticipant,
} from "./rooms-client-harness";

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
      focus: () => undefined,
    }));
    return <div data-testid="room-session-composer" />;
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

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => null,
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    parentMessage,
    replies,
    isLoading,
    onClose,
  }: {
    parentMessage: ChatRoomMessage;
    replies: ChatRoomMessage[];
    isLoading: boolean;
    onClose: () => void;
  }) => (
    <div
      data-testid="thread-panel"
      data-parent-id={parentMessage.id}
      data-loading={String(isLoading)}
    >
      <span data-testid="thread-reply-ids">
        {replies.map((reply) => reply.id).join(",")}
      </span>
      <button type="button" data-testid="thread-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => null,
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
    isReadOnly: false,
    formerUserMembers: [],
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
    userMembers: [userParticipant("user-1", "Ada")],
    coworkerMembers: [coworkerParticipant("coworker-1", "Eve")],
    sokoBotMembers: [],
  };
}

function parentMessage(id: string, content: string): ChatRoomMessage {
  return {
    id,
    roomId: "room-coworker",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 1,
    threadLastReplyAt: new Date("2026-07-01T12:02:00.000Z"),
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: userParticipant("user-1", "Ada"),
    },
  };
}

function replyMessage(
  id: string,
  parentId: string,
  createdAt = "2026-07-01T12:02:00.000Z",
): ChatRoomMessage {
  return {
    ...parentMessage(id, `Reply ${id}`),
    parentMessageId: parentId,
    createdAt: new Date(createdAt),
    threadReplyCount: 0,
    threadLastReplyAt: null,
  };
}

function latestOnStreamSettled(): UseCoworkerDirectRoomStreamParams["onStreamSettled"] {
  const lastCall = useCoworkerDirectRoomStreamMock.mock.calls.at(-1)?.[0] as
    | UseCoworkerDirectRoomStreamParams
    | undefined;
  if (!lastCall) {
    throw new Error("useCoworkerDirectRoomStream was not called");
  }
  return lastCall.onStreamSettled;
}

describe("RoomsClient late coworker stream thread refresh", () => {
  const p1 = parentMessage("parent-1", "Parent 1");
  const p2 = parentMessage("parent-2", "Parent 2");

  beforeEach(() => {
    readStoredStreamParentMessageIdMock.mockReset();
    readStoredStreamParentMessageIdMock.mockReturnValue(null);
    markThreadReadAction.mockReset();
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listRoomMessagesAction.mockReset();
    listThreadMessagesAction.mockReset();
    markOrganizationChatRoomReadAction.mockReset();
    markOrganizationChatRoomReadAction.mockResolvedValue({
      ok: true as const,
      value: {
        id: "room-coworker",
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      },
    });
  });

  it("does not merge P1's late finish refresh into P2's open thread panel", async () => {
    const p1LateRefresh = Promise.withResolvers<{
      ok: true;
      value: { messages: ChatRoomMessage[]; nextCursor: null };
    }>();

    let p1ListCalls = 0;
    listThreadMessagesAction.mockImplementation(
      async (_roomId: string, parentId: string) => {
        if (parentId === "parent-1") {
          p1ListCalls += 1;
          if (p1ListCalls === 1) {
            return {
              ok: true as const,
              value: {
                messages: [replyMessage("p1-r1", "parent-1")],
                nextCursor: null,
              },
            };
          }
          return p1LateRefresh.promise;
        }
        return {
          ok: true as const,
          value: {
            messages: [replyMessage("p2-r1", "parent-2")],
            nextCursor: null,
          },
        };
      },
    );
    listRoomMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [p1, p2], nextCursor: null },
    });

    const room = coworkerDirectRoom();
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          selectedRoomId: room.id,
          messages: [p1, p2],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("open-thread-parent-1"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-parent-id",
        "parent-1",
      );
      expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p1-r1");
    });

    const settlePromise = Promise.resolve(latestOnStreamSettled()(room.id));
    await waitFor(() => {
      expect(p1ListCalls).toBe(2);
    });

    fireEvent.click(screen.getByTestId("open-thread-parent-2"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-parent-id",
        "parent-2",
      );
      expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p2-r1");
    });

    await act(async () => {
      p1LateRefresh.resolve({
        ok: true,
        value: {
          messages: [
            replyMessage("p1-r1", "parent-1"),
            replyMessage("p1-r2", "parent-1", "2026-07-01T12:03:00.000Z"),
          ],
          nextCursor: null,
        },
      });
      expect(await settlePromise).toBe(true);
    });

    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-parent-id",
      "parent-2",
    );
    expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p2-r1");
  });

  it("merges P1's finish refresh when P1 stays open", async () => {
    let p1ListCalls = 0;
    listThreadMessagesAction.mockImplementation(async () => {
      p1ListCalls += 1;
      return {
        ok: true as const,
        value: {
          messages:
            p1ListCalls === 1
              ? [replyMessage("p1-r1", "parent-1")]
              : [
                  replyMessage("p1-r1", "parent-1"),
                  replyMessage("p1-r2", "parent-1", "2026-07-01T12:03:00.000Z"),
                ],
          nextCursor: null,
        },
      };
    });
    listRoomMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [p1, p2], nextCursor: null },
    });

    const room = coworkerDirectRoom();
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          selectedRoomId: room.id,
          messages: [p1, p2],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("open-thread-parent-1"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p1-r1");
    });

    await act(async () => {
      expect(await latestOnStreamSettled()(room.id)).toBe(true);
    });

    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-parent-id",
      "parent-1",
    );
    expect(screen.getByTestId("thread-reply-ids").textContent).toBe(
      "p1-r1,p1-r2",
    );
  });

  it("does not reopen P1 when the user closes P1 before its finish refresh arrives", async () => {
    const p1LateRefresh = Promise.withResolvers<{
      ok: true;
      value: { messages: ChatRoomMessage[]; nextCursor: null };
    }>();

    let p1ListCalls = 0;
    listThreadMessagesAction.mockImplementation(async () => {
      p1ListCalls += 1;
      if (p1ListCalls === 1) {
        return {
          ok: true as const,
          value: {
            messages: [replyMessage("p1-r1", "parent-1")],
            nextCursor: null,
          },
        };
      }
      return p1LateRefresh.promise;
    });
    listRoomMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [p1, p2], nextCursor: null },
    });

    const room = coworkerDirectRoom();
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          selectedRoomId: room.id,
          messages: [p1, p2],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("open-thread-parent-1"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p1-r1");
    });

    const settlePromise = Promise.resolve(latestOnStreamSettled()(room.id));
    await waitFor(() => {
      expect(p1ListCalls).toBe(2);
    });

    fireEvent.click(screen.getByTestId("thread-close"));
    expect(screen.queryByTestId("thread-panel")).toBeNull();

    await act(async () => {
      p1LateRefresh.resolve({
        ok: true,
        value: {
          messages: [
            replyMessage("p1-r1", "parent-1"),
            replyMessage("p1-r2", "parent-1", "2026-07-01T12:03:00.000Z"),
          ],
          nextCursor: null,
        },
      });
      expect(await settlePromise).toBe(true);
    });

    expect(screen.queryByTestId("thread-panel")).toBeNull();
  });

  it("drops a stored-parent P1 finish refresh when P2 opens before it arrives", async () => {
    const p1LateRefresh = Promise.withResolvers<{
      ok: true;
      value: { messages: ChatRoomMessage[]; nextCursor: null };
    }>();
    readStoredStreamParentMessageIdMock.mockReturnValue("parent-1");

    listThreadMessagesAction.mockImplementation(
      async (_roomId: string, parentId: string) => {
        if (parentId === "parent-1") {
          return p1LateRefresh.promise;
        }
        return {
          ok: true as const,
          value: {
            messages: [replyMessage("p2-r1", "parent-2")],
            nextCursor: null,
          },
        };
      },
    );
    listRoomMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [p1, p2], nextCursor: null },
    });

    const room = coworkerDirectRoom();
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          selectedRoomId: room.id,
          messages: [p1, p2],
        })}
      />,
    );

    const settlePromise = Promise.resolve(latestOnStreamSettled()(room.id));
    await waitFor(() => {
      expect(listThreadMessagesAction).toHaveBeenCalledWith(
        room.id,
        "parent-1",
      );
    });

    fireEvent.click(screen.getByTestId("open-thread-parent-2"));
    await waitFor(() => {
      expect(screen.getByTestId("thread-panel")).toHaveAttribute(
        "data-parent-id",
        "parent-2",
      );
      expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p2-r1");
    });

    await act(async () => {
      p1LateRefresh.resolve({
        ok: true,
        value: {
          messages: [replyMessage("p1-r1", "parent-1")],
          nextCursor: null,
        },
      });
      expect(await settlePromise).toBe(true);
    });

    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-parent-id",
      "parent-2",
    );
    expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p2-r1");
  });

  it("still applies stored-parent finish refresh when the panel stayed closed", async () => {
    readStoredStreamParentMessageIdMock.mockReturnValue("parent-1");
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: {
        messages: [replyMessage("p1-r1", "parent-1")],
        nextCursor: null,
      },
    });
    listRoomMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [p1, p2], nextCursor: null },
    });

    const room = coworkerDirectRoom();
    renderWithQueryClient(
      <RoomsClient
        {...roomsClientBaseProps({
          rooms: [room],
          selectedRoomId: room.id,
          messages: [p1, p2],
        })}
      />,
    );

    expect(screen.queryByTestId("thread-panel")).toBeNull();

    await act(async () => {
      expect(await latestOnStreamSettled()(room.id)).toBe(true);
    });

    expect(screen.getByTestId("thread-panel")).toHaveAttribute(
      "data-parent-id",
      "parent-1",
    );
    expect(screen.getByTestId("thread-reply-ids").textContent).toBe("p1-r1");
  });
});
