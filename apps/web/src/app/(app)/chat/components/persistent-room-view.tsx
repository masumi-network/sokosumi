"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
} from "react";
import type { RoomTranscriptEntry } from "@/app/chat/utils/room-transcript-cache";
import { chatQueryKeys } from "@/queries/chat";
import { usePaintedRoom, useRoomCache } from "./room-cache-provider";
import { RoomOpenLoadingView } from "./room-open-loading-view";
import { RoomsClient, type RoomsClientProps } from "./rooms-client";

const NO_ROOM_KEY = chatQueryKeys.noRoomTranscript();

const RoomBootstrapContext = createContext<
  ((props: RoomsClientProps) => void) | null
>(null);

/**
 * Lives above the route's loading boundary. Next owns URLs and access
 * validation; a room painted before its page did so from a click read that
 * Core answered only for a member. Which room paints is decided by
 * `RoomCacheSession`, which the app chrome reads too.
 */
export function PersistentRoomView({ children }: { children: ReactNode }) {
  const painted = usePaintedRoom();
  const cache = useRoomCache();
  const requestedId = painted?.requestedId;
  // Keeps the click's read for the target alive while chat shows; the
  // session reads it without observing, so it still expires elsewhere.
  useQuery<RoomTranscriptEntry>(
    {
      queryKey: cache && requestedId ? cache.key(requestedId) : NO_ROOM_KEY,
      queryFn: skipToken,
    },
    cache?.client,
  );
  if (!painted) return children;
  const { roomId, bootstrap, register } = painted;
  return (
    <RoomBootstrapContext value={register}>
      {roomId ? (
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
  // Same mutable availability read as RoomCacheSession's painted room.
  "use no memo";
  const cache = useRoomCache()!;
  const { data } = useQuery<RoomTranscriptEntry>(
    { queryKey: cache.key(roomId), queryFn: skipToken },
    cache.client,
  );
  const available = cache.available(roomId);
  const selected = available
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
        {available ? children : <RoomOpenLoadingView />}
      </div>
      {selected ? <RoomsClient {...selected} /> : null}
    </>
  );
}

/** All room views live above page replacement; all rooms retain history. */
export function RoomRouteBootstrap(props: RoomsClientProps) {
  const cache = useRoomCache();
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
    const existing = cache.get(roomId);
    cache.client.setQueryData(
      cache.key(roomId),
      existing
        ? {
            ...existing,
            bootstrap: {
              ...props,
              messages: [],
              loadHistoryOnClient: true,
            },
          }
        : cache.seed(props),
    );
  }, [cache, props, register]);
  return register ? null : <RoomsClient {...props} />;
}
