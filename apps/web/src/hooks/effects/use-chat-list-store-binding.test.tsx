// @vitest-environment happy-dom

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { act, render, renderHook } from "@testing-library/react";
import { Activity, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatListStore } from "@/components/chat/chat-list-store";
import {
  clearMembershipVisibleRoomsSnapshot,
  getLatestMembershipVisibleRoomsSnapshot,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { useOrganizationChatRooms } from "@/components/chat/use-organization-chat-rooms";
import { setAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";

import { useChatListStoreBinding } from "./use-chat-list-store-binding";

const { fetchBackgroundJsonMock } = vi.hoisted(() => ({
  fetchBackgroundJsonMock:
    vi.fn<
      (
        url: string,
        timeoutMs: number,
        onStatus?: (status: number) => void,
      ) => Promise<unknown>
    >(),
}));

vi.mock("@/components/chat/fetch-background-json", () => ({
  fetchBackgroundJson: (...args: Parameters<typeof fetchBackgroundJsonMock>) =>
    fetchBackgroundJsonMock(...args),
}));

const TIMESTAMP = "2026-09-08T10:00:00.000Z";
const NO_ROOMS: ChatRoom[] = [];
const NO_INVITATIONS: ChatRoomInvitation[] = [];

function makeRoom(id: string): ChatRoom {
  return {
    id,
    name: id,
    slug: id,
    kind: "channel",
    myAccess: "member",
    discoverability: "public",
    createdAt: new Date(TIMESTAMP),
    updatedAt: new Date(TIMESTAMP),
    starredAt: null,
    mutedAt: null,
    unreadCount: 0,
    channelUnreadCount: 0,
    threadUnreadCount: 0,
    unreadMentionCount: 0,
    unreadNeedsYouCount: 0,
    markedUnread: false,
    userMembers: [],
    agentMembers: [],
  } as unknown as ChatRoom;
}

function pageEnvelope(data: unknown[]) {
  return {
    data,
    meta: {
      timestamp: TIMESTAMP,
      requestId: "req-1",
      pagination: { nextCursor: null },
    },
  };
}

function makeStoreSpy() {
  const events: string[] = [];
  const store: ChatListStore = {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => ({
      roomRows: NO_ROOMS,
      archivedRows: NO_ROOMS,
      pendingRows: NO_INVITATIONS,
      sourceRooms: NO_ROOMS,
      sourceArchivedRooms: NO_ROOMS,
      sourcePendingInvitations: NO_INVITATIONS,
    })),
    attach: vi.fn((scope, healthy) => {
      events.push(
        `attach:${scope.organizationId ?? ""}:${scope.currentUserId}:${String(healthy)}`,
      );
    }),
    detach: vi.fn(() => {
      events.push("detach");
    }),
    setHealth: vi.fn((healthy) => {
      events.push(`health:${healthy}`);
    }),
    syncProps: vi.fn((props) => {
      events.push(`syncProps:${props.rooms.length}`);
    }),
    setArchivedRows: vi.fn(),
    setPendingRows: vi.fn(),
    upsertRoomToTop: vi.fn(),
    replaceRoom: vi.fn(),
    replaceAllRooms: vi.fn(() => true),
    applyPinnedOrder: vi.fn(),
  };
  return { store, events };
}

interface ProbeProps {
  store: ChatListStore;
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  currentUserId?: string;
  organizationId?: string | null;
  paintOnly?: boolean;
  healthy?: boolean;
  onPassiveEffect?: () => void;
}

function BindingProbe({
  store,
  rooms = NO_ROOMS,
  archivedRooms = NO_ROOMS,
  pendingInvitations = NO_INVITATIONS,
  currentUserId = "user-1",
  organizationId = "org-1",
  paintOnly = false,
  healthy = true,
  onPassiveEffect,
}: ProbeProps) {
  useChatListStoreBinding({
    store,
    rooms,
    archivedRooms,
    pendingInvitations,
    currentUserId,
    organizationId,
    paintOnly,
    healthy,
  });

  useEffect(() => {
    onPassiveEffect?.();
  });

  return null;
}

describe("useChatListStoreBinding", () => {
  beforeEach(() => {
    fetchBackgroundJsonMock.mockReset();
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    setAblyConnectionHealthy(false);
  });

  afterEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    setAblyConnectionHealthy(false);
    vi.restoreAllMocks();
  });

  it("attaches on mount, detaches on unmount, and handles scope changes", () => {
    const { store, events } = makeStoreSpy();

    const { rerender, unmount } = render(
      <BindingProbe
        store={store}
        organizationId="org-1"
        currentUserId="user-1"
        healthy={true}
      />,
    );

    expect(events).toEqual([
      "syncProps:0",
      "attach:org-1:user-1:true",
      "health:true",
    ]);

    events.length = 0;
    rerender(
      <BindingProbe
        store={store}
        organizationId="org-2"
        currentUserId="user-1"
        healthy={true}
      />,
    );
    expect(events).toEqual(["detach", "attach:org-2:user-1:true"]);

    events.length = 0;
    rerender(
      <BindingProbe
        store={store}
        organizationId="org-2"
        currentUserId="user-1"
        healthy={false}
      />,
    );
    expect(events).toEqual(["health:false"]);

    events.length = 0;
    unmount();
    expect(events).toEqual(["detach"]);
  });

  it("skips attach and detach when paintOnly is true", () => {
    const { store } = makeStoreSpy();

    const { unmount } = render(<BindingProbe store={store} paintOnly={true} />);

    expect(store.attach).not.toHaveBeenCalled();
    unmount();
    expect(store.detach).not.toHaveBeenCalled();
  });

  it("detaches on React Activity hide and re-attaches on Activity reveal", () => {
    const { store, events } = makeStoreSpy();

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );

    expect(store.attach).toHaveBeenCalledTimes(2);
    expect(store.detach).toHaveBeenCalledTimes(1);

    events.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );
    expect(events).toEqual(["detach"]);

    events.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );
    expect(events).toContain("attach:org-1:user-1:true");

    unmount();
  });

  it("hands changed RSC rows to the store in a layout effect before passive effects run", () => {
    const { store, events } = makeStoreSpy();
    const recordPassive = () => {
      events.push("passive");
    };

    const { rerender } = render(
      <BindingProbe store={store} onPassiveEffect={recordPassive} />,
    );
    events.length = 0;

    const nextRooms = [makeRoom("room-1")];
    rerender(
      <BindingProbe
        store={store}
        rooms={nextRooms}
        onPassiveEffect={recordPassive}
      />,
    );

    expect(events).toEqual(["syncProps:1", "passive"]);
    expect(store.syncProps).toHaveBeenLastCalledWith({
      rooms: nextRooms,
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
    });
  });

  it("publishes (new rows, new seed) once when RSC rooms change on the same mount, never (old rows, new seed)", () => {
    fetchBackgroundJsonMock.mockReturnValue(new Promise(() => {}));
    const oldSeed = [makeRoom("old")];
    const newSeed = [makeRoom("new")];
    const publications: Array<{
      roomIds: string[];
      sourceRooms: readonly ChatRoom[] | undefined;
    }> = [];

    const unsubscribe = subscribeMembershipVisibleRooms(() => {
      const snap = getLatestMembershipVisibleRoomsSnapshot();
      if (snap) {
        publications.push({
          roomIds: snap.rooms.map((room) => room.id),
          sourceRooms: snap.sourceRooms,
        });
      }
    });

    const { rerender, unmount } = renderHook(
      ({ rooms }: { rooms: ChatRoom[] }) =>
        useOrganizationChatRooms({
          rooms,
          archivedRooms: NO_ROOMS,
          pendingInvitations: NO_INVITATIONS,
          currentUserId: "user-1",
          organizationId: "org-1",
          paintOnly: false,
        }),
      { initialProps: { rooms: oldSeed } },
    );

    publications.length = 0;
    rerender({ rooms: newSeed });

    expect(publications).toEqual([{ roomIds: ["new"], sourceRooms: newSeed }]);

    unsubscribe();
    unmount();
  });

  it("batches active,archived,invitations when organizationId changes in the same commit as health recovery", async () => {
    setAblyConnectionHealthy(true);
    fetchBackgroundJsonMock.mockResolvedValue({
      data: {
        active: pageEnvelope([]),
        archived: pageEnvelope([]),
        invitations: pageEnvelope([]),
      },
    });

    const { rerender, unmount } = renderHook(
      ({ organizationId }: { organizationId: string }) =>
        useOrganizationChatRooms({
          rooms: NO_ROOMS,
          archivedRooms: NO_ROOMS,
          pendingInvitations: NO_INVITATIONS,
          currentUserId: "user-1",
          organizationId,
          paintOnly: false,
        }),
      { initialProps: { organizationId: "org-1" } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    fetchBackgroundJsonMock.mockClear();

    act(() => {
      setAblyConnectionHealthy(false);
    });

    fetchBackgroundJsonMock.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      setAblyConnectionHealthy(true);
      rerender({ organizationId: "org-2" });
      await Promise.resolve();
    });

    expect(fetchBackgroundJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchBackgroundJsonMock.mock.calls[0]?.[0]).toBe(
      "/api/chat/rooms?collections=active,archived,invitations",
    );

    unmount();
  });
});
