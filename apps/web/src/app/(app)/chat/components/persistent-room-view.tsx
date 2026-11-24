"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RoomTranscriptEntry } from "@/app/chat/utils/room-transcript-cache";
import {
  RoomBootstrapContext,
  useRoomRouteBootstrap,
} from "@/hooks/effects/use-room-route-bootstrap";
import { chatQueryKeys } from "@/queries/chat";
import { usePaintedRoom, useRoomCache } from "./room-cache-provider";
import { RoomOpenLoadingView } from "./room-open-loading-view";
import { RoomsClient, type RoomsClientProps } from "./rooms-client";

const NO_ROOM_KEY = chatQueryKeys.noRoomTranscript();

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
  const hasProvider = useRoomRouteBootstrap(cache, props);
  return hasProvider ? null : <RoomsClient {...props} />;
}
