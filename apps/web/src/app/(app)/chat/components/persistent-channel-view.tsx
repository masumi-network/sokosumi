"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import type { ChannelTranscriptEntry } from "@/app/chat/utils/channel-transcript-cache";
import { useChannelCache, useChannelSelection } from "./channel-cache-provider";
import { RoomsClient, type RoomsClientProps } from "./rooms-client";

const RoomBootstrapContext = createContext<
  ((props: RoomsClientProps) => void) | null
>(null);

/** Lives above the route's loading boundary. Next owns URLs and access validation. */
export function PersistentChannelView({ children }: { children: ReactNode }) {
  const cache = useChannelCache();
  const path = useChannelSelection();
  const [bootstrap, setBootstrap] = useState<RoomsClientProps | null>(null);
  const roomId = path?.split("?")[0].match(/^\/chat\/rooms\/([^/]+)\/?$/)?.[1];
  return (
    <RoomBootstrapContext value={setBootstrap}>
      {cache && roomId ? (
        <SelectedRoom key={roomId} roomId={roomId} bootstrap={bootstrap}>
          {children}
        </SelectedRoom>
      ) : (
        children
      )}
    </RoomBootstrapContext>
  );
}

function SelectedRoom({
  roomId,
  bootstrap,
  children,
}: {
  roomId: string;
  bootstrap: RoomsClientProps | null;
  children: ReactNode;
}) {
  const cache = useChannelCache()!;
  const { data } = useQuery<ChannelTranscriptEntry>(
    { queryKey: cache.key(roomId), queryFn: skipToken },
    cache.client,
  );
  const selected = cache.available(roomId)
    ? (data?.bootstrap ??
      (bootstrap?.selectedRoomId === roomId ? bootstrap : null))
    : null;
  return (
    <>
      {/* Room pages only register metadata; hidden children never own a live room. */}
      <div
        hidden={Boolean(selected)}
        className={selected ? undefined : "contents"}
      >
        {children}
      </div>
      {selected ? <RoomsClient {...selected} /> : null}
    </>
  );
}

/** All room views live above page replacement; only Channels retain history. */
export function ChannelRouteBootstrap(props: RoomsClientProps) {
  const cache = useChannelCache();
  const register = useContext(RoomBootstrapContext);
  useLayoutEffect(() => {
    const roomId = props.selectedRoomId;
    if (
      !cache ||
      !roomId ||
      !cache.available(roomId) ||
      !cache.matchesScope(
        props.currentUserId,
        props.activeOrganization?.id ?? null,
      )
    )
      return;
    register?.(props);
    if (props.rooms.find((room) => room.id === roomId)?.kind !== "channel")
      return;
    const existing = cache.get(roomId);
    cache.client.setQueryData(
      cache.key(roomId),
      existing
        ? {
            ...existing,
            bootstrap: {
              ...props,
              messages: [],
              messagesPromise: undefined,
              loadHistoryOnClient: true,
            },
          }
        : cache.seed(props),
    );
  }, [cache, props, register]);
  return register ? null : <RoomsClient {...props} />;
}
