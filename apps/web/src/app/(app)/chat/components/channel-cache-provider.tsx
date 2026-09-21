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
import { ChannelTranscriptCache } from "@/app/chat/utils/channel-transcript-cache";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";

const ChannelSelectionContext = createContext<string | null>(null);
export function useChannelSelection() {
  return useContext(ChannelSelectionContext);
}

const ChannelCacheContext = createContext<{
  cache: ChannelTranscriptCache;
  generation: number;
} | null>(null);
export function useChannelCache() {
  return useContext(ChannelCacheContext)?.cache ?? null;
}

export function ChannelCacheProvider({
  currentUserId,
  workspaceId,
  children,
}: {
  currentUserId: string;
  workspaceId: string | null;
  children: ReactNode;
}) {
  return (
    <ChannelCacheSession
      key={JSON.stringify([currentUserId, workspaceId])}
      currentUserId={currentUserId}
      workspaceId={workspaceId}
    >
      {children}
    </ChannelCacheSession>
  );
}

function ChannelCacheSession({
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
  const [cache] = useState(
    () => new ChannelTranscriptCache(client, currentUserId, workspaceId),
  );
  useEffect(() => {
    const select = (url: URL) =>
      setNavigation({ pathname, target: url.pathname + url.search });
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
  }, [pathname]);
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
    <ChannelCacheContext value={{ cache, generation }}>
      <ChannelSelectionContext value={target}>
        {children}
      </ChannelSelectionContext>
    </ChannelCacheContext>
  );
}
