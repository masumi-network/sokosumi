"use client";

import { useEffect, useState } from "react";
import { getRoomThreadAction } from "@/app/chat/actions";

/**
 * Loads the current reader's mute status for the open thread while it is
 * unknown, retrying when `replyCount` changes so a parent message becomes
 * mutable once its first reply lands.
 */
export function useThreadMuteStatus(
  roomId: string,
  parentMessageId: string,
  replyCount: number,
): {
  muted: boolean | null;
  setThreadMuted: (next: boolean) => void;
} {
  const threadKey = `${roomId}:${parentMessageId}`;
  const [known, setKnown] = useState<{ key: string; muted: boolean | null }>({
    key: threadKey,
    muted: null,
  });
  // Another thread's answer says nothing about this one.
  const muted = known.key === threadKey ? known.muted : null;

  useEffect(() => {
    // Only read while the state is unknown. A reply landing mid-toggle must
    // not race the write it would overtake.
    if (muted !== null) {
      return;
    }
    let active = true;
    void getRoomThreadAction(roomId, parentMessageId)
      .then((result) => {
        if (!active || !result.ok) {
          return;
        }
        setKnown({ key: threadKey, muted: result.value.mutedAt !== null });
      })
      // A server action rejects instead of answering with a result when the
      // POST comes back as something other than RSC. Leave the state unknown,
      // exactly as a failed read does, so the button stays hidden.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [muted, roomId, parentMessageId, threadKey, replyCount]);

  function setThreadMuted(next: boolean) {
    setKnown({ key: threadKey, muted: next });
  }

  return { muted, setThreadMuted };
}
