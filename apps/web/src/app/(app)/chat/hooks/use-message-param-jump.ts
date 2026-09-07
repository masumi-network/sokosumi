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
 * Jump to the message a notification named, once per message it names.
 *
 * A notification click lands on the room with the message on its URL. The
 * reader may then scroll somewhere else, and the room re-renders for reasons
 * of its own: a new message arrives, the roster loads, the window resizes.
 * None of those are a second request to jump, so the message is jumped to once
 * and then left alone.
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

  useEffect(() => {
    if (!roomId || !messageId || !ready) {
      return;
    }

    const target = `${roomId}:${messageId}`;
    if (jumpedRef.current === target) {
      return;
    }

    // Marked before the jump runs, so a re-render while it is still loading
    // messages does not start a second one.
    jumpedRef.current = target;
    jump(messageId);
    // `jump` is redefined every render by the room client. A changed identity
    // re-runs this effect and stops at the guard above, so it costs nothing
    // and keeps the callback current for the jump that does happen.
  }, [roomId, messageId, ready, jump]);
}
