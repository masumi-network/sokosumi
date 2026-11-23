import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatQueryKeys } from "@/queries/chat";
import { ChatControlListBridge } from "./chat-control-list-bridge";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "./organization-chat-events";

const { subscribeMock, unsubscribeMock, ablyClient } = vi.hoisted(() => {
  const subscribeMock = vi.fn();
  const unsubscribeMock = vi.fn();
  return {
    subscribeMock,
    unsubscribeMock,
    ablyClient: {
      connection: { state: "connected", on: vi.fn(), off: vi.fn() },
      channels: {
        get: () => ({ subscribe: subscribeMock, unsubscribe: unsubscribeMock }),
      },
    },
  };
});

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

function handlerFor(eventName: string) {
  const call = subscribeMock.mock.calls.find((args) => args[0] === eventName);
  return call?.[1] as ((message: { data: unknown }) => void) | undefined;
}

function sampleRoom(id: string): ChatRoom {
  return {
    id,
    name: id,
    kind: "channel",
    updatedAt: new Date("2026-11-23T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
  } as ChatRoom;
}

describe("ChatControlListBridge", () => {
  const scope = { userId: "user-1", workspaceId: "org-1" };

  beforeEach(() => {
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
  });

  it("cancels in-flight reads and invalidates only the named sidebar collections on chat_rooms_changed", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const activeKey = chatQueryKeys.sidebarRoomCollection(scope, "active");
    const archivedKey = chatQueryKeys.sidebarRoomCollection(scope, "archived");
    const invitationsKey = chatQueryKeys.sidebarRoomCollection(
      scope,
      "invitations",
    );
    const transcriptKey = chatQueryKeys.transcript(scope, "room-1");

    const pendingActive = Promise.withResolvers<ChatRoom[]>();
    let activeAborted = false;
    const inFlight = queryClient
      .fetchQuery({
        queryKey: activeKey,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            activeAborted = true;
          });
          return pendingActive.promise;
        },
      })
      .catch(() => undefined);
    queryClient.setQueryData(archivedKey, []);
    queryClient.setQueryData(invitationsKey, []);
    queryClient.setQueryData(transcriptKey, []);

    const seenDetails: OrganizationChatRoomsChangedDetail[] = [];
    const onChanged = (event: Event) => {
      seenDetails.push(
        (event as CustomEvent<OrganizationChatRoomsChangedDetail>).detail,
      );
    };
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, onChanged);

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ChatControlListBridge currentUserId="user-1" />
      </QueryClientProvider>,
    );

    try {
      act(() => {
        handlerFor("chat_rooms_changed")?.({
          data: {
            collections: ["active"],
            roomId: "room-1",
            at: "2026-11-23T12:00:00.000Z",
          },
        });
      });

      expect(activeAborted).toBe(true);
      expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(invitationsKey)?.isInvalidated).toBe(
        false,
      );
      expect(queryClient.getQueryState(transcriptKey)?.isInvalidated).toBe(
        false,
      );
      expect(seenDetails).toEqual([
        { collections: ["active"], roomId: "room-1" },
      ]);

      // The cancelled older read must never commit once it settles.
      await act(async () => {
        pendingActive.resolve([sampleRoom("stale-room")]);
        await inFlight;
      });
      expect(queryClient.getQueryData(activeKey)).toBeUndefined();
    } finally {
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        onChanged,
      );
      unmount();
      queryClient.clear();
    }
  });

  it("cancels in-flight reads, drops the revoked room from cached lists at once, and invalidates the sidebar prefix on chat_membership_revoked", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const activeKey = chatQueryKeys.sidebarRoomCollection(scope, "active");
    const archivedKey = chatQueryKeys.sidebarRoomCollection(scope, "archived");
    const invitationsKey = chatQueryKeys.sidebarRoomCollection(
      scope,
      "invitations",
    );
    queryClient.setQueryData(activeKey, [
      sampleRoom("room-kept"),
      sampleRoom("room-revoked"),
    ]);
    queryClient.setQueryData(archivedKey, [sampleRoom("room-revoked")]);
    queryClient.setQueryData(invitationsKey, []);

    const pendingRead = Promise.withResolvers<ChatRoom[]>();
    let aborted = false;
    const inFlight = queryClient
      .fetchQuery({
        queryKey: activeKey,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return pendingRead.promise;
        },
        staleTime: 0,
      })
      .catch(() => undefined);

    const seenDetails: OrganizationChatRoomsChangedDetail[] = [];
    const onChanged = (event: Event) => {
      seenDetails.push(
        (event as CustomEvent<OrganizationChatRoomsChangedDetail>).detail,
      );
    };
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, onChanged);

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ChatControlListBridge currentUserId="user-1" />
      </QueryClientProvider>,
    );

    try {
      act(() => {
        handlerFor("chat_membership_revoked")?.({
          data: {
            roomId: "room-revoked",
            reason: "removed",
            at: "2026-11-23T12:00:00.000Z",
          },
        });
      });

      expect(aborted).toBe(true);
      expect(
        queryClient.getQueryData<ChatRoom[]>(activeKey)?.map((room) => room.id),
      ).toEqual(["room-kept"]);
      expect(queryClient.getQueryData<ChatRoom[]>(archivedKey)).toEqual([]);
      expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(invitationsKey)?.isInvalidated).toBe(
        true,
      );
      expect(seenDetails).toEqual([{ removedRoomId: "room-revoked" }]);

      // The cancelled older read must never restore the revoked room.
      await act(async () => {
        pendingRead.resolve([
          sampleRoom("room-kept"),
          sampleRoom("room-revoked"),
        ]);
        await inFlight;
      });
      expect(
        queryClient.getQueryData<ChatRoom[]>(activeKey)?.map((room) => room.id),
      ).toEqual(["room-kept"]);
    } finally {
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        onChanged,
      );
      unmount();
      queryClient.clear();
    }
  });
});
