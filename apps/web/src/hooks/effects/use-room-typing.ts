"use client";

import {
  makeChatTypingChannelName,
  parseUserIdFromAblyPresenceClientId,
} from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { capabilityGrants } from "@/lib/ably/ably-capability-map";
import { authorizeAbly } from "@/lib/ably/authorize.client";
import { registerAblyChatRoomScope } from "@/lib/ably/chat-room-auth-scope.client";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";
import {
  applyTypingEvent,
  EMPTY_TYPING_SET,
  liveTypistIds,
  nextTypingPublishAction,
  sameTypistIds,
  type TypingSet,
  type TypingState,
} from "@/lib/ably/room-typing-model";
import {
  safeDetachChannel,
  safeSubscribeChannel,
} from "@/lib/ably/safe-detach-channel";
import { chatTypingEventDataSchema } from "@/lib/ably/schema";

const CHAT_TYPING_EVENT_NAME = "chat_typing";

/**
 * How often a reader re-checks who has gone quiet. Typing expiry is time-based,
 * so without a tick a typist who simply stops would linger until the next
 * event arrives — which, if they were the only one typing, is never.
 */
const TYPING_SWEEP_TICK_MS = 1_000;

export const EMPTY_TYPIST_IDS: readonly string[] = [];

export interface RoomTypingActions {
  /**
   * Call after a genuine composer input event — a keystroke or a paste.
   * Never call it for a restored Draft: that is what keeps opening a room you
   * abandoned a Draft in silent.
   */
  handleComposerChange: (composerHasText: boolean) => void;
  /** Send, blur, or leaving the room. Safe to call when not announced. */
  handleStopTyping: () => void;
}

export interface RoomTyping extends RoomTypingActions {
  /** Live typists in this room, in the order they started. Never includes you. */
  typistIds: readonly string[];
}

export interface RoomTypingSnapshot {
  roomId: string | null;
  typistIds: readonly string[];
}

const EMPTY_ROOM_TYPING_SNAPSHOT: RoomTypingSnapshot = {
  roomId: null,
  typistIds: EMPTY_TYPIST_IDS,
};

export interface RoomTypingStore extends RoomTypingActions {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RoomTypingSnapshot;
  getServerSnapshot: () => RoomTypingSnapshot;
  setTypistIds: (roomId: string | null, next: readonly string[]) => void;
  setActions: (actions: RoomTypingActions | null) => void;
}

export function createRoomTypingStore(): RoomTypingStore {
  let snapshot: RoomTypingSnapshot = EMPTY_ROOM_TYPING_SNAPSHOT;
  let actions: RoomTypingActions | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getServerSnapshot() {
      return EMPTY_ROOM_TYPING_SNAPSHOT;
    },
    setTypistIds(roomId, next) {
      if (
        snapshot.roomId === roomId &&
        sameTypistIds(snapshot.typistIds, next)
      ) {
        return;
      }
      snapshot = {
        roomId,
        typistIds: next.length === 0 ? EMPTY_TYPIST_IDS : next,
      };
      for (const listener of listeners) {
        listener();
      }
    },
    setActions(next) {
      actions = next;
    },
    handleComposerChange(composerHasText) {
      actions?.handleComposerChange(composerHasText);
    },
    handleStopTyping() {
      actions?.handleStopTyping();
    },
  };
}

/**
 * Sync one room's typing channel (ADR-0033) into an external store: publish on
 * the room's typing channel, read everyone else's off it, and expire a typist
 * who goes quiet.
 *
 * Attach and publish are both gated on the token capability. A token minted
 * before this shipped grants neither, and attaching without a grant produces
 * capability-denied unhandled rejections (SOKOSUMI-R0), so a missing grant
 * means the room simply shows nobody rather than throwing.
 */
export function useRoomTypingSync(
  roomId: string | null | undefined,
  selfUserId: string | null | undefined,
  store: RoomTypingStore,
): void {
  const ably = useAbly();
  const publishRef = useRef<((state: TypingState) => boolean) | null>(null);
  const startedPublishedAtMsRef = useRef<number | null>(null);

  const handleComposerChange = useCallback((composerHasText: boolean) => {
    const nowMs = Date.now();
    const action = nextTypingPublishAction({
      composerHasText,
      startedPublishedAtMs: startedPublishedAtMsRef.current,
      nowMs,
    });
    if (action === "none") {
      return;
    }
    if (action === "start") {
      // Only open a throttle window if the room actually heard us.
      if (publishRef.current?.("started")) {
        startedPublishedAtMsRef.current = nowMs;
      }
      return;
    }
    startedPublishedAtMsRef.current = null;
    publishRef.current?.("stopped");
  }, []);

  const handleStopTyping = useCallback(() => {
    if (startedPublishedAtMsRef.current == null) {
      return;
    }
    startedPublishedAtMsRef.current = null;
    publishRef.current?.("stopped");
  }, []);

  useEffect(() => {
    if (!roomId || !selfUserId) {
      store.setTypistIds(null, EMPTY_TYPIST_IDS);
      store.setActions(null);
      return;
    }

    const activeRoomId = roomId;
    const activeSelfUserId = selfUserId;
    const releaseRoomScope = registerAblyChatRoomScope([activeRoomId]);
    const channelName = makeChatTypingChannelName(
      activeRoomId,
      getRealtimeChannelEnvironment(),
    );

    let cancelled = false;
    let channel: Ably.RealtimeChannel | null = null;
    let set: TypingSet = EMPTY_TYPING_SET;
    let canPublish = false;
    let intervalId: number | undefined;
    let syncInFlight = false;
    let syncQueued = false;

    store.setTypistIds(activeRoomId, EMPTY_TYPIST_IDS);
    store.setActions({ handleComposerChange, handleStopTyping });
    startedPublishedAtMsRef.current = null;

    function recompute() {
      if (cancelled) {
        return;
      }
      const next = liveTypistIds(set, Date.now());
      store.setTypistIds(activeRoomId, next);
    }

    function handleMessage(message: Ably.Message) {
      const parsed = chatTypingEventDataSchema.safeParse(message.data);
      if (!parsed.success) {
        return;
      }
      // Ably stamps clientId from the token, so it is the one part of the
      // message the sender cannot choose. Without this a room member could
      // publish somebody else's userId and put words in their line — or a
      // `stopped` to clear it. The payload field still has to agree, so a
      // client that gets its own identity wrong fails closed rather than
      // announcing under the wrong name.
      const senderUserId = message.clientId
        ? parseUserIdFromAblyPresenceClientId(message.clientId)
        : null;
      if (senderUserId == null || senderUserId !== parsed.data.userId) {
        return;
      }
      // Thread-scoped Typing is not shown yet; a payload that claims a Thread
      // must not light up the main transcript's line (ADR-0033).
      if (parsed.data.parentMessageId != null) {
        return;
      }
      set = applyTypingEvent(
        set,
        {
          userId: parsed.data.userId,
          state: parsed.data.state,
          atMs: Date.now(),
        },
        activeSelfUserId,
      );
      recompute();
    }

    /**
     * Returns whether the message was handed to Ably — not whether it was
     * delivered, which is only known once the promise settles. The caller
     * records "we are announced" on true, so a keystroke arriving before the
     * channel attaches does not open a throttle window nobody heard.
     */
    function publish(state: TypingState): boolean {
      if (!channel || !canPublish) {
        return false;
      }
      channel
        .publish({
          name: CHAT_TYPING_EVENT_NAME,
          data: {
            userId: activeSelfUserId,
            state,
            parentMessageId: null,
          },
          // Never persisted, never replayed on resume: a reconnecting reader
          // starts with nobody typing, which is the correct state.
          extras: { ephemeral: true },
        })
        .catch((error: unknown) => {
          console.error("Ably chat_typing publish failed:", error);
        });
      return true;
    }

    publishRef.current = publish;

    function tearDown() {
      if (channel) {
        channel.unsubscribe(CHAT_TYPING_EVENT_NAME, handleMessage);
        safeDetachChannel(channel);
        channel = null;
      }
      canPublish = false;
      set = EMPTY_TYPING_SET;
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
      if (!cancelled) {
        store.setTypistIds(activeRoomId, EMPTY_TYPIST_IDS);
      }
    }

    async function runSyncOnce() {
      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await authorizeAbly(ably);
      } catch (error) {
        if (!cancelled) {
          console.error("Ably authorize for typing failed:", error);
          tearDown();
        }
        return;
      }
      if (cancelled) {
        return;
      }

      const capability = tokenDetails?.capability;
      if (!capabilityGrants(capability, channelName, "subscribe")) {
        tearDown();
        return;
      }
      canPublish = capabilityGrants(capability, channelName, "publish");

      if (!channel) {
        channel = ably.channels.get(channelName);
        safeSubscribeChannel(channel, CHAT_TYPING_EVENT_NAME, handleMessage);
        intervalId = window.setInterval(recompute, TYPING_SWEEP_TICK_MS);
      }
    }

    /**
     * Coalesce mount + connected so two authorizes never overlap: a reconnect
     * landing mid-authorize queues a re-run instead of issuing its own token
     * request. Same guard as `useOrgPresenceMap`.
     */
    async function sync() {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        do {
          syncQueued = false;
          await runSyncOnce();
        } while (syncQueued && !cancelled);
      } finally {
        syncInFlight = false;
      }
    }

    const onConnected = () => {
      void sync();
    };
    ably.connection.on("connected", onConnected);
    void sync();

    return () => {
      cancelled = true;
      releaseRoomScope();
      ably.connection.off("connected", onConnected);
      // Leaving is one of the four stops. The detach below races this publish,
      // so the stop may not land — which is exactly the case the 12s expiry
      // exists for. Nothing here needs it to be guaranteed.
      if (startedPublishedAtMsRef.current != null) {
        publish("stopped");
      }
      publishRef.current = null;
      startedPublishedAtMsRef.current = null;
      store.setActions(null);
      tearDown();
    };
  }, [ably, handleComposerChange, handleStopTyping, roomId, selfUserId, store]);
}

/** Typing for one room (ADR-0033): publish and observe live typists. */
export function useRoomTyping(
  roomId: string | null | undefined,
  selfUserId: string | null | undefined,
): RoomTyping {
  const [store] = useState(createRoomTypingStore);
  useRoomTypingSync(roomId, selfUserId, store);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const typistIds =
    roomId && snapshot.roomId === roomId
      ? snapshot.typistIds
      : EMPTY_TYPIST_IDS;

  return {
    typistIds,
    handleComposerChange: store.handleComposerChange,
    handleStopTyping: store.handleStopTyping,
  };
}
