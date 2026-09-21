"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import type {
  RoomTranscriptCache,
  RoomTranscriptEntry,
} from "@/app/chat/utils/room-transcript-cache";
import { useRoomCache, useRoomSelection } from "./room-cache-provider";
import { RoomOpenLoadingView } from "./room-open-loading-view";
import { RoomsClient, type RoomsClientProps } from "./rooms-client";

const RoomBootstrapContext = createContext<
  ((props: RoomsClientProps) => void) | null
>(null);

function roomIdFromPath(path: string | null | undefined): string | undefined {
  return path?.split("?")[0].match(/^\/chat\/rooms\/([^/]+)\/?$/)?.[1];
}

/** Cached room, or the page bootstrap that just registered this room. */
function roomCanPaint(
  cache: RoomTranscriptCache,
  roomId: string,
  bootstrap: RoomsClientProps | null,
): boolean {
  if (!cache.available(roomId)) return false;
  if (cache.get(roomId)?.bootstrap.selectedRoomId === roomId) return true;
  return bootstrap?.selectedRoomId === roomId;
}

/** Lives above the route's loading boundary. Next owns URLs and access validation. */
export function PersistentRoomView({ children }: { children: ReactNode }) {
  const cache = useRoomCache();
  const path = useRoomSelection();
  const [bootstrap, setBootstrap] = useState<RoomsClientProps | null>(null);
  const requestedId = roomIdFromPath(path);
  const [paintedId, setPaintedId] = useState(requestedId);
  // A click updates the target before the next page can register. Painting
  // that id immediately unmounts the open room onto a page that renders null.
  const targetRevoked = Boolean(
    requestedId && cache && !cache.available(requestedId),
  );
  const targetReady = Boolean(
    requestedId && cache && roomCanPaint(cache, requestedId, bootstrap),
  );
  const nextPaintedId = !cache
    ? requestedId
    : !requestedId
      ? undefined
      : targetReady || targetRevoked
        ? requestedId
        : paintedId;
  if (nextPaintedId !== paintedId) setPaintedId(nextPaintedId);
  const roomId = cache ? nextPaintedId : requestedId;
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
              messagesPromise: undefined,
              loadHistoryOnClient: true,
            },
          }
        : cache.seed(props),
    );
  }, [cache, props, register]);
  return register ? null : <RoomsClient {...props} />;
}
