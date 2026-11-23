import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOtherWorkspaceRooms } from "@/components/chat/use-other-workspace-rooms";
import { chatQueryKeys, splitChatQueryKey } from "@/queries/chat";

const { fetchElsewhereMock } = vi.hoisted(() => ({
  fetchElsewhereMock: vi.fn<() => Promise<ChatRoom[] | null>>(),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchElsewhereMock,
}));

const scopeA = { userId: "user_a", workspaceId: "org_a" };
const scopeB = { userId: "user_a", workspaceId: "org_b" };
const personal = { userId: "user_a", workspaceId: null };

function unreadElsewhereRoom(id: string, name: string): ChatRoom {
  return {
    id,
    name,
    kind: "channel",
    organizationId: "org_elsewhere",
    organizationName: "Elsewhere Org",
    organizationLogo: null,
    organizationWebsiteUrl: null,
    unreadCount: 1,
    channelUnreadCount: 1,
    threadUnreadCount: 0,
    unreadThreadCount: 0,
    unreadThreadMentionCount: 0,
    unreadThreads: [],
    unreadMentionCount: 0,
    unreadNeedsYouCount: 0,
    markedUnread: false,
    starredAt: null,
    starredSortKey: null,
    mutedAt: null,
  } as unknown as ChatRoom;
}

describe("chatQueryKeys", () => {
  beforeEach(() => {
    fetchElsewhereMock.mockReset();
  });

  it("normalizes missing and null scope members to one identity with scope first", () => {
    expect(
      chatQueryKeys.elsewhere({ userId: "user_a", workspaceId: undefined }),
    ).toEqual(chatQueryKeys.elsewhere(personal));
    expect(chatQueryKeys.elsewhere({})).toEqual([
      { userId: null, workspaceId: null },
      "chat",
      "elsewhere",
    ]);

    expect(chatQueryKeys.prefix(scopeA)).toEqual([scopeA, "chat"]);
    expect(chatQueryKeys.sidebarRooms(scopeA)).toEqual([
      scopeA,
      "chat",
      "sidebar-rooms",
    ]);
    expect(chatQueryKeys.sidebarRoomCollection(scopeA, "active")).toEqual([
      scopeA,
      "chat",
      "sidebar-rooms",
      "active",
    ]);
    expect(
      splitChatQueryKey(chatQueryKeys.sidebarRoomCollection(scopeA, "active")),
    ).toEqual({
      scope: scopeA,
      queryKey: ["chat", "sidebar-rooms", "active"],
    });
    expect(chatQueryKeys.sidebarDeferred(scopeA, 3)).toEqual([
      scopeA,
      "chat",
      "sidebar-deferred",
      3,
    ]);
    expect(chatQueryKeys.roster(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "roster",
      "room_1",
    ]);
    expect(chatQueryKeys.transcripts(scopeA)).toEqual([
      scopeA,
      "chat",
      "transcript",
    ]);
    expect(chatQueryKeys.transcript(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "transcript",
      "room_1",
    ]);
    expect(chatQueryKeys.elsewhere(scopeA)).toEqual([
      scopeA,
      "chat",
      "elsewhere",
    ]);
    expect(chatQueryKeys.threads(scopeA, "room_1")).toEqual([
      scopeA,
      "chat",
      "threads",
      "room_1",
    ]);
    expect(chatQueryKeys.openAtUnread("room_1", 2)).toEqual([
      { userId: null, workspaceId: null },
      "chat",
      "open-at-unread",
      "room_1",
      2,
    ]);
  });

  it("matches all user and workspace scopes with cross-scope prefixes without matching other domains", () => {
    const queryClient = new QueryClient();
    const transcriptA = chatQueryKeys.transcript(scopeA, "room_1");
    const transcriptPersonal = chatQueryKeys.transcript(personal, "room_2");
    const elsewhereA = chatQueryKeys.elsewhere(scopeA);
    const elsewhereB = chatQueryKeys.elsewhere(scopeB);
    const sidebarActiveA = chatQueryKeys.sidebarRoomCollection(
      scopeA,
      "active",
    );
    const sidebarArchivedA = chatQueryKeys.sidebarRoomCollection(
      scopeA,
      "archived",
    );
    const sidebarActiveB = chatQueryKeys.sidebarRoomCollection(
      scopeB,
      "active",
    );
    const driveKey = [{ scope: "me" }, "drive", "folders"] as const;

    queryClient.setQueryDefaults(chatQueryKeys.anyTranscript(), {
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });

    expect(queryClient.getQueryDefaults(transcriptA)).toMatchObject({
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });
    expect(queryClient.getQueryDefaults(transcriptPersonal)).toMatchObject({
      gcTime: 1800_000,
      enabled: false,
      structuralSharing: false,
    });
    expect(queryClient.getQueryDefaults(elsewhereA)).toEqual({});
    expect(queryClient.getQueryDefaults(driveKey)).toEqual({});

    queryClient.setQueryData(elsewhereA, ["room-a"]);
    queryClient.setQueryData(elsewhereB, ["room-b"]);
    queryClient.setQueryData(transcriptA, ["msg-a"]);

    queryClient.setQueriesData<string[]>(
      { queryKey: chatQueryKeys.anyElsewhere() },
      (rows) => rows?.map((row) => `${row}:updated`),
    );

    expect(queryClient.getQueryData(elsewhereA)).toEqual(["room-a:updated"]);
    expect(queryClient.getQueryData(elsewhereB)).toEqual(["room-b:updated"]);
    expect(queryClient.getQueryData(transcriptA)).toEqual(["msg-a"]);

    queryClient.setQueryData(sidebarActiveA, ["a1"]);
    queryClient.setQueryData(sidebarArchivedA, ["ar1"]);
    queryClient.setQueryData(sidebarActiveB, ["b1"]);

    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.anySidebarRoomCollection("active"),
      refetchType: "none",
    });
    expect(queryClient.getQueryState(sidebarActiveA)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sidebarActiveB)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sidebarArchivedA)?.isInvalidated).toBe(
      false,
    );

    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.anySidebarRooms(),
      refetchType: "none",
    });
    expect(queryClient.getQueryState(sidebarArchivedA)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(transcriptA)?.isInvalidated).toBe(false);
  });

  it("shows no unpinned Elsewhere rows from the previous workspace while the next workspace read is pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const workspaceBDeferred = Promise.withResolvers<ChatRoom[]>();
    fetchElsewhereMock
      .mockResolvedValueOnce([unreadElsewhereRoom("room-a", "Alpha Room")])
      .mockReturnValueOnce(workspaceBDeferred.promise);

    function ElsewhereProbe({
      organizationId,
    }: {
      organizationId: string | null;
    }) {
      const { rooms } = useOtherWorkspaceRooms({
        currentUserId: "user_a",
        organizationId,
        enabled: true,
      });

      return (
        <ul>
          {rooms.map((room) => (
            <li key={room.id}>{room.name}</li>
          ))}
        </ul>
      );
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ElsewhereProbe organizationId="org_a" />
      </QueryClientProvider>,
    );

    await screen.findByText("Alpha Room");

    rerender(
      <QueryClientProvider client={queryClient}>
        <ElsewhereProbe organizationId="org_b" />
      </QueryClientProvider>,
    );

    // While org_b's read is still pending, org_a's unpinned row must stay gone.
    expect(screen.queryByText("Alpha Room")).toBeNull();

    workspaceBDeferred.resolve([unreadElsewhereRoom("room-b", "Beta Room")]);
    await waitFor(() => {
      expect(screen.getByText("Beta Room")).toBeTruthy();
    });
    expect(screen.queryByText("Alpha Room")).toBeNull();
  });
});
