"use client";

import {
  createContext,
  type ReactNode,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import {
  createRoomTypingStore,
  EMPTY_TYPIST_IDS,
  type RoomTypingActions,
  type RoomTypingStore,
  useRoomTypingSync,
} from "@/hooks/effects/use-room-typing";

export interface RoomTypingContextValue extends RoomTypingActions {
  /** False outside a provider — the Thread composer, tests, coworker DMs. */
  enabled: boolean;
  typistIds: readonly string[];
}

const INERT: RoomTypingContextValue = {
  enabled: false,
  typistIds: EMPTY_TYPIST_IDS,
  handleComposerChange: () => {},
  handleStopTyping: () => {},
};

const RoomTypingContext = createContext<RoomTypingContextValue | null>(null);

/**
 * Ably island: the only place that touches the realtime client. Syncs typing
 * state and actions into the provider's external store.
 */
function RoomTypingIsland({
  roomId,
  currentUserId,
  store,
}: {
  roomId: string;
  currentUserId: string;
  store: RoomTypingStore;
}) {
  useRoomTypingSync(roomId, currentUserId, store);
  return null;
}

interface RoomTypingProviderProps {
  roomId: string;
  /** Absent while the session is still resolving; the island waits for it. */
  currentUserId: string | null | undefined;
  children: ReactNode;
}

/**
 * Typing for one room's main transcript (ADR-0033).
 *
 * The realtime client lives in a `LazyAblyProvider` **sibling island**, the
 * same shape as `OrgPresenceProvider`, so the composer never blocks on the
 * Ably chunk and never calls `useAbly` itself — the composer renders outside
 * any Ably provider, where that hook throws.
 *
 * Mount this around the room composer only. The Thread composer sits outside
 * it and therefore stays silent, which is what keeps a Thread reply from
 * claiming the room is about to get a message.
 */
export function RoomTypingProvider({
  roomId,
  currentUserId,
  children,
}: RoomTypingProviderProps) {
  const [store] = useState(createRoomTypingStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const typistIds =
    currentUserId && snapshot.roomId === roomId
      ? snapshot.typistIds
      : EMPTY_TYPIST_IDS;

  const value = useMemo<RoomTypingContextValue>(
    () => ({
      enabled: true,
      typistIds,
      handleComposerChange: store.handleComposerChange,
      handleStopTyping: store.handleStopTyping,
    }),
    [typistIds, store],
  );

  return (
    <RoomTypingContext value={value}>
      {children}
      {currentUserId ? (
        <LazyAblyProvider>
          <RoomTypingIsland
            roomId={roomId}
            currentUserId={currentUserId}
            store={store}
          />
        </LazyAblyProvider>
      ) : null}
    </RoomTypingContext>
  );
}

/** Inert outside a provider, so every other composer works untouched. */
export function useRoomTypingContext(): RoomTypingContextValue {
  return use(RoomTypingContext) ?? INERT;
}
