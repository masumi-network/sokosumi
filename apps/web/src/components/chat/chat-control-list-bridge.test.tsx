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

describe("ChatControlListBridge", () => {
  const scope = { userId: "user-1", workspaceId: "org-1" };

  beforeEach(() => {
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
  });

  it("invalidates only the named sidebar collections on chat_rooms_changed", () => {
    const queryClient = new QueryClient();
    const activeKey = chatQueryKeys.sidebarRoomCollection(scope, "active");
    const archivedKey = chatQueryKeys.sidebarRoomCollection(scope, "archived");
    const invitationsKey = chatQueryKeys.sidebarRoomCollection(
      scope,
      "invitations",
    );
    const transcriptKey = chatQueryKeys.transcript(scope, "room-1");

    queryClient.setQueryData(activeKey, []);
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
    } finally {
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        onChanged,
      );
      unmount();
      queryClient.clear();
    }
  });

  it("cancels in-flight sidebar reads and invalidates the sidebar prefix on chat_membership_revoked", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const activeKey = chatQueryKeys.sidebarRoomCollection(scope, "active");
    const archivedKey = chatQueryKeys.sidebarRoomCollection(scope, "archived");
    const invitationsKey = chatQueryKeys.sidebarRoomCollection(
      scope,
      "invitations",
    );
    const pendingRead = Promise.withResolvers<string[]>();
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
      })
      .catch(() => undefined);
    queryClient.setQueryData(archivedKey, []);
    queryClient.setQueryData(invitationsKey, []);

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
      expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(invitationsKey)?.isInvalidated).toBe(
        true,
      );
      expect(seenDetails).toEqual([{ removedRoomId: "room-revoked" }]);

      await act(async () => {
        pendingRead.resolve(["room-revoked"]);
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
});
