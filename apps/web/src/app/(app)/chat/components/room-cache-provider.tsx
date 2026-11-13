"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { roomIdFromPath } from "@/app/chat/utils/chat-route-base";
import {
  ROOM_APPROACH_REUSE_MS,
  RoomTranscriptCache,
} from "@/app/chat/utils/room-transcript-cache";
import { getLatestMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";
import { shouldUseCoworkerRoomStream } from "./room-helpers";
import type { RoomsClientProps } from "./rooms-client";

/** The sidebar's row for a room, when the sidebar shows this user and workspace. */
function sidebarRoom(
  roomId: string,
  currentUserId: string,
  workspaceId: string | null,
) {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  if (
    snapshot?.currentUserId !== currentUserId ||
    snapshot.organizationId !== workspaceId
  )
    return null;
  return snapshot.rooms.find((row) => row.id === roomId) ?? null;
}

/**
 * Room chrome from the sidebar's row, until the room page registers its own.
 * Roster and the caller's channel-admin role arrive with that page. Coworker
 * stream rooms wait for it: their stream needs the organization slug.
 */
export function provisionalRoomBootstrap(
  roomId: string,
  currentUserId: string,
  workspaceId: string | null,
): RoomsClientProps | null {
  const room = sidebarRoom(roomId, currentUserId, workspaceId);
  if (!room || shouldUseCoworkerRoomStream(room)) return null;
  return {
    loadHistoryOnClient: true,
    activeOrganization: workspaceId ? { id: workspaceId, slug: null } : null,
    rooms: [room],
    organizationMembers: [],
    currentUserId,
    isOrgOwnerOrAdmin: false,
    coworkers: [],
    selectedRoomId: roomId,
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [],
    messagesNextCursor: null,
  };
}

/**
 * Whether a click opens the room at its Unread divider, the way the room
 * decides it on mount: Room unread on the sidebar's row, and no named message.
 */
export function clickOpensAtUnread(
  url: URL,
  roomId: string,
  currentUserId: string,
  workspaceId: string | null,
): boolean {
  const room = sidebarRoom(roomId, currentUserId, workspaceId);
  return (
    room != null &&
    (room.channelUnreadCount ?? room.unreadCount) > 0 &&
    !url.searchParams.has(CHAT_MESSAGE_PARAM)
  );
}

const RoomSelectionContext = createContext<string | null>(null);
export function useRoomSelection() {
  return useContext(RoomSelectionContext);
}

interface RoomCacheSessionValue {
  cache: RoomTranscriptCache;
  generation: number;
  currentUserId: string;
  workspaceId: string | null;
}

const RoomCacheContext = createContext<RoomCacheSessionValue | null>(null);
export function useRoomCache() {
  return useContext(RoomCacheContext)?.cache ?? null;
}

/**
 * Ref for a room link. It starts the room's open reads when the reader heads
 * for the link: the cursor's path, a Tab stop close by, or a touch. The click
 * then takes those reads instead of starting them. Nothing paints from them
 * before the click, so a reader who turns away leaves no room behind.
 */
export function useRoomIntentPrefetch(href: string, enabled: boolean) {
  const session = useContext(RoomCacheContext);
  return useIntentPrefetch<HTMLAnchorElement>(
    () => {
      if (!session) return;
      const url = new URL(href, window.location.origin);
      const roomId = roomIdFromPath(url.pathname);
      if (!roomId) return;
      session.cache.approach(
        roomId,
        clickOpensAtUnread(
          url,
          roomId,
          session.currentUserId,
          session.workspaceId,
        ),
      );
    },
    // An approach that read nothing, for the cap or a throttle, may try again
    // this soon. The cache turns down a repeat for a room it did read.
    { reactivateAfter: ROOM_APPROACH_REUSE_MS, enabled },
  );
}

export function RoomCacheProvider({
  currentUserId,
  workspaceId,
  children,
}: {
  currentUserId: string;
  workspaceId: string | null;
  children: ReactNode;
}) {
  // A workspace switch swaps the cache, not the tree: a room shown in every
  // workspace stays mounted with its draft.
  return (
    <RoomCacheSession
      key={currentUserId}
      currentUserId={currentUserId}
      workspaceId={workspaceId}
    >
      {children}
    </RoomCacheSession>
  );
}

function RoomCacheSession({
  currentUserId,
  workspaceId,
  children,
}: {
  currentUserId: string;
  workspaceId: string | null;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const [navigation, setNavigation] = useState({ pathname, target: pathname });
  if (navigation.pathname !== pathname)
    setNavigation({ pathname, target: pathname });
  const target =
    navigation.pathname === pathname ? navigation.target : pathname;
  const replace = useEffectEvent((href: string) => router.replace(href));
  const [generation, setGeneration] = useState(0);
  const [cache, setCache] = useState(
    () => new RoomTranscriptCache(client, currentUserId, workspaceId),
  );
  if (!cache.matchesScope(currentUserId, workspaceId))
    setCache(cache.forWorkspace(workspaceId, roomIdFromPath(pathname)));
  useEffect(() => {
    const select = (url: URL) => {
      setNavigation({ pathname, target: url.pathname + url.search });
      const roomId = roomIdFromPath(url.pathname);
      if (!roomId) return;
      cache.prefetch(roomId, () =>
        provisionalRoomBootstrap(roomId, currentUserId, workspaceId),
      );
      if (clickOpensAtUnread(url, roomId, currentUserId, workspaceId))
        cache.prefetchUnreadWindow(roomId);
    };
    const clicked = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target ||
        link.hasAttribute("download")
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin === window.location.origin &&
        /^\/chat\/rooms\/[^/]+\/?$/.test(url.pathname)
      )
        select(url);
    };
    const popped = () => select(new URL(window.location.href));
    window.addEventListener("click", clicked, true);
    window.addEventListener("popstate", popped);
    return () => {
      window.removeEventListener("click", clicked, true);
      window.removeEventListener("popstate", popped);
    };
  }, [cache, currentUserId, pathname, workspaceId]);
  useEffect(() => {
    cache.activate();
    const ended = () => {
      cache.clear();
      setGeneration((value) => value + 1);
    };
    const removed = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      if (detail?.joinedRoomId) {
        cache.joined(detail.joinedRoomId);
        setGeneration((value) => value + 1);
      }
      if (detail?.removedRoomId) {
        cache.evict(detail.removedRoomId);
        setGeneration((value) => value + 1);
        if (window.location.pathname === `/chat/rooms/${detail.removedRoomId}`)
          replace("/?notice=room-unavailable");
      }
    };
    window.addEventListener("chat-session-ended", ended);
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, removed);
    return () => {
      window.removeEventListener("chat-session-ended", ended);
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        removed,
      );
      cache.clear();
    };
  }, [cache]);
  return (
    <RoomCacheContext value={{ cache, generation, currentUserId, workspaceId }}>
      <RoomSelectionContext value={target}>{children}</RoomSelectionContext>
    </RoomCacheContext>
  );
}
