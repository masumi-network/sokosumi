import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRoomReadOverlays,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import { chatQueryKeys } from "@/queries/chat";
import {
  hasNewOrganizationChatRoomsSeed,
  useOrganizationChatRoomsSeedSync,
} from "./use-organization-chat-rooms-seed-sync";

const EMPTY_ROOMS: ChatRoom[] = [];
const EMPTY_INVITATIONS: ChatRoomInvitation[] = [];

function sampleRoom(id: string, unreadCount = 0): ChatRoom {
  return {
    id,
    name: id,
    unreadCount,
    unreadMentionCount: 0,
    markedUnread: false,
    updatedAt: new Date("2026-11-23T10:00:00Z"),
  } as ChatRoom;
}

function SeedSyncProbe({
  queryClient,
  rooms,
  archivedRooms = EMPTY_ROOMS,
  pendingInvitations = EMPTY_INVITATIONS,
}: {
  queryClient: QueryClient;
  rooms: ChatRoom[];
  archivedRooms?: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
}) {
  const scope = { userId: "u1", workspaceId: "org1" };
  useOrganizationChatRoomsSeedSync({
    queryClient,
    activeKey: chatQueryKeys.sidebarRoomCollection(scope, "active"),
    rooms,
    archivedKey: chatQueryKeys.sidebarRoomCollection(scope, "archived"),
    archivedRooms,
    invitationsKey: chatQueryKeys.sidebarRoomCollection(scope, "invitations"),
    pendingInvitations,
  });
  return null;
}

describe("useOrganizationChatRoomsSeedSync", () => {
  afterEach(() => {
    clearRoomReadOverlays();
  });

  it("keeps cached fetched rows on unchanged remount and replaces them when a new seed prop arrives", () => {
    const queryClient = new QueryClient();
    const key = chatQueryKeys.sidebarRoomCollection(
      { userId: "u1", workspaceId: "org1" },
      "active",
    );
    const initialSeed = [sampleRoom("room-1", 3)];
    rememberRoomRead({ ...initialSeed[0], unreadCount: 0 });

    // Cold mount seeds empty cache with read overlays applied.
    const first = render(
      <StrictMode>
        <SeedSyncProbe queryClient={queryClient} rooms={initialSeed} />
      </StrictMode>,
    );
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.[0]?.unreadCount).toBe(0);
    expect(hasNewOrganizationChatRoomsSeed(queryClient, key, initialSeed)).toBe(
      false,
    );

    // Fetch updates cache while mounted; remounting with the same seed keeps fetched data.
    queryClient.setQueryData(key, [
      sampleRoom("room-1"),
      sampleRoom("room-fetched"),
    ]);
    first.unmount();

    expect(hasNewOrganizationChatRoomsSeed(queryClient, key, initialSeed)).toBe(
      false,
    );
    const remount = render(
      <StrictMode>
        <SeedSyncProbe queryClient={queryClient} rooms={initialSeed} />
      </StrictMode>,
    );
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["room-1", "room-fetched"],
    );

    // Fresh server seed replaces cached rows.
    const freshSeed = [sampleRoom("room-fresh")];
    expect(hasNewOrganizationChatRoomsSeed(queryClient, key, freshSeed)).toBe(
      true,
    );
    remount.rerender(
      <StrictMode>
        <SeedSyncProbe queryClient={queryClient} rooms={freshSeed} />
      </StrictMode>,
    );
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["room-fresh"],
    );
    expect(hasNewOrganizationChatRoomsSeed(queryClient, key, freshSeed)).toBe(
      false,
    );

    remount.unmount();
    queryClient.clear();
  });

  it("does not overwrite data already fetched by another observer on first mount", () => {
    const queryClient = new QueryClient();
    const key = chatQueryKeys.sidebarRoomCollection(
      { userId: "u1", workspaceId: "org1" },
      "active",
    );
    queryClient.setQueryData(key, [sampleRoom("already-fetched")]);
    const staleSeed = [sampleRoom("stale-rsc")];

    const { unmount } = render(
      <SeedSyncProbe queryClient={queryClient} rooms={staleSeed} />,
    );
    expect(queryClient.getQueryData<ChatRoom[]>(key)?.map((r) => r.id)).toEqual(
      ["already-fetched"],
    );

    unmount();
    queryClient.clear();
  });
});
