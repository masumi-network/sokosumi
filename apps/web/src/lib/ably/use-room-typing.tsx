"use client";

import { makeChatTypingChannelName } from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { capabilityGrants } from "./ably-capability-map";
import {
  applyTypingEvent,
  EMPTY_TYPING_SET,
  liveTypistIds,
  nextTypingPublishAction,
  sameTypistIds,
  type TypingSet,
  type TypingState,
} from "./room-typing-model";
import { chatTypingEventDataSchema } from "./schema";

const CHAT_TYPING_EVENT_NAME = "chat_typing";

/**
 * How often a reader re-checks who has gone quiet. Typing expiry is time-based,
 * so without a tick a typist who simply stops would linger until the next
 * event arrives — which, if they were the only one typing, is never.
 */
const TYPING_SWEEP_TICK_MS = 1_000;

export interface RoomTyping {
  /** Live typists in this room, in the order they started. Never includes you. */
  typistIds: readonly string[];
  /**
   * Call after a genuine composer input event — a keystroke or a paste.
   * Never call it for a restored Draft: that is what keeps opening a room you
   * abandoned a Draft in silent.
   */
  handleComposerChange: (composerHasText: boolean) => void;
  /** Send, blur, or leaving the room. Safe to call when not announced. */
  handleStopTyping: () => void;
}

/**
 * Typing for one room (ADR-0033): publish on the room's typing channel, read
 * everyone else's off it, and expire a typist who goes quiet.
 *
 * Attach and publish are both gated on the token capability. A token minted
 * before this shipped grants neither, and attaching without a grant produces
 * capability-denied unhandled rejections (SOKOSUMI-R0), so a missing grant
 * means the room simply shows nobody rather than throwing.
 */
export function useRoomTyping(
  roomId: string | null | undefined,
  selfUserId: string | null | undefined,
): RoomTyping {
  const ably = useAbly();
  const [typistIds, setTypistIds] = useState<readonly string[]>([]);
  const publishRef = useRef<((state: TypingState) => boolean) | null>(null);
  const startedPublishedAtMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomId || !selfUserId) {
      setTypistIds([]);
      return;
    }

    const activeRoomId = roomId;
    const activeSelfUserId = selfUserId;
    const channelName = makeChatTypingChannelName(activeRoomId);

    let cancelled = false;
    let channel: Ably.RealtimeChannel | null = null;
    let set: TypingSet = EMPTY_TYPING_SET;
    let canPublish = false;
    let intervalId: number | undefined;
    let syncInFlight = false;
    let syncQueued = false;

    setTypistIds([]);
    startedPublishedAtMsRef.current = null;

    function recompute() {
      if (cancelled) {
        return;
      }
      const next = liveTypistIds(set, Date.now());
      setTypistIds((previous) =>
        sameTypistIds(previous, next) ? previous : next,
      );
    }

    function handleMessage(message: Ably.Message) {
      const parsed = chatTypingEventDataSchema.safeParse(message.data);
      if (!parsed.success) {
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
        channel.detach();
        channel = null;
      }
      canPublish = false;
      set = EMPTY_TYPING_SET;
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
      if (!cancelled) {
        setTypistIds([]);
      }
    }

    async function runSyncOnce() {
      let tokenDetails: Ably.TokenDetails | null = null;
      try {
        tokenDetails = await ably.auth.authorize();
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
        channel.subscribe(CHAT_TYPING_EVENT_NAME, handleMessage);
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
      ably.connection.off("connected", onConnected);
      // Leaving is one of the four stops. The detach below races this publish,
      // so the stop may not land — which is exactly the case the 12s expiry
      // exists for. Nothing here needs it to be guaranteed.
      if (startedPublishedAtMsRef.current != null) {
        publish("stopped");
      }
      publishRef.current = null;
      startedPublishedAtMsRef.current = null;
      tearDown();
    };
  }, [ably, roomId, selfUserId]);

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

  return { typistIds, handleComposerChange, handleStopTyping };
}
