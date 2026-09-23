"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { sameTypistIds } from "@/lib/ably/room-typing-model";
import { useRoomTyping } from "@/lib/ably/use-room-typing";

interface RoomTypingActions {
  handleComposerChange: (composerHasText: boolean) => void;
  handleStopTyping: () => void;
}

export interface RoomTypingContextValue extends RoomTypingActions {
  /** False outside a provider — the Thread composer, tests, coworker DMs. */
  enabled: boolean;
  typistIds: readonly string[];
}

const INERT: RoomTypingContextValue = {
  enabled: false,
  typistIds: [],
  handleComposerChange: () => {},
  handleStopTyping: () => {},
};

const RoomTypingContext = createContext<RoomTypingContextValue | null>(null);

/**
 * Ably island: the only place that touches the realtime client. Reports state
 * up and hands its actions to the provider's ref.
 */
function RoomTypingIsland({
  roomId,
  currentUserId,
  actionsRef,
  onTypistsChange,
}: {
  roomId: string;
  currentUserId: string;
  actionsRef: { current: RoomTypingActions | null };
  onTypistsChange: (typistIds: readonly string[]) => void;
}) {
  const { typistIds, handleComposerChange, handleStopTyping } = useRoomTyping(
    roomId,
    currentUserId,
  );

  useEffect(() => {
    onTypistsChange(typistIds);
  }, [onTypistsChange, typistIds]);

  useEffect(() => {
    actionsRef.current = { handleComposerChange, handleStopTyping };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, handleComposerChange, handleStopTyping]);

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
  const [typistIds, setTypistIds] = useState<readonly string[]>([]);
  const actionsRef = useRef<RoomTypingActions | null>(null);

  /**
   * Keep the previous array when the people are the same. The island reports
   * upward from an effect keyed on the list it was handed, so swallowing an
   * equal-but-new array is what stops report → setState → re-render → report
   * from spinning forever.
   */
  const handleTypistsChange = useCallback((next: readonly string[]) => {
    setTypistIds((previous) =>
      sameTypistIds(previous, next) ? previous : next,
    );
  }, []);

  const handleComposerChange = useCallback((composerHasText: boolean) => {
    actionsRef.current?.handleComposerChange(composerHasText);
  }, []);

  const handleStopTyping = useCallback(() => {
    actionsRef.current?.handleStopTyping();
  }, []);

  const value = useMemo<RoomTypingContextValue>(
    () => ({
      enabled: true,
      typistIds,
      handleComposerChange,
      handleStopTyping,
    }),
    [typistIds, handleComposerChange, handleStopTyping],
  );

  return (
    <RoomTypingContext value={value}>
      {children}
      {currentUserId ? (
        <LazyAblyProvider>
          <RoomTypingIsland
            roomId={roomId}
            currentUserId={currentUserId}
            actionsRef={actionsRef}
            onTypistsChange={handleTypistsChange}
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
