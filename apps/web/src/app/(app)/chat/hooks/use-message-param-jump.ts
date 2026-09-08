"use client";

import { useEffect, useRef } from "react";

interface MessageParamJumpParams {
  /** The room on screen, or null before one is selected. */
  roomId: string | null;
  /** The message the URL names, or null when it names none. */
  messageId: string | null;
  /**
   * The room's messages have loaded. A jump before that has nothing to find
   * and nothing to hold its scroll position against.
   */
  ready: boolean;
  jump: (messageId: string) => void;
}

/**
 * Jump to the message a notification named, once per arrival at it.
 *
 * A notification click lands on the room with the message on its URL. The
 * reader may then scroll somewhere else, and the room re-renders for reasons
 * of its own: a new message arrives, the roster loads, the window resizes.
 * None of those are a second request to jump, so the message is jumped to once
 * and then left alone.
 *
 * Leaving the message behind forgets it. The room client stays mounted across
 * rooms, so a reader who opens a notification, wanders off to another room and
 * clicks the same notification again is arriving a second time and is owed the
 * jump a second time. Remembering it for the life of the component would leave
 * that click doing nothing at all.
 *
 * A second notification for the same room names a different message and is
 * jumped to, which is what makes clicking the second one worth doing.
 */
export function useMessageParamJump({
  roomId,
  messageId,
  ready,
  jump,
}: MessageParamJumpParams): void {
  const jumpedRef = useRef<string | null>(null);
  const target = roomId && messageId ? `${roomId}:${messageId}` : null;

  useEffect(() => {
    // No room, or no message named on it: whatever the reader was sent to is
    // behind them, so the next arrival at it counts as new. Deliberately not
    // keyed on `ready`, which drops on any reload of the room the reader is
    // still sitting in.
    // The second half looks redundant against the first and is not: it is
    // what narrows `messageId` to a string for the call below.
    if (!target || !messageId) {
      jumpedRef.current = null;
      return;
    }

    if (!ready || jumpedRef.current === target) {
      return;
    }

    // Marked before the jump rather than after it. Nothing observable turns
    // on the order today: `jump` does highlight and replace the URL before
    // its first await, but none of that re-enters this effect, and the state
    // it sets lands in a batch. It is written this way so that stays true of
    // whatever `jump` becomes.
    jumpedRef.current = target;
    jump(messageId);
    // `jump` is listed so the jump that happens always uses the current
    // callback. Whether its identity changes each render is up to the caller
    // and the compiler; either way a re-run stops at the guard above, so the
    // logic rests on `target` and the ref rather than on that identity.
  }, [target, messageId, ready, jump]);
}
