"use client";

import { Megaphone, MegaphoneOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { getRoomThreadAction, setThreadMutedAction } from "../actions";

/**
 * Mute / unmute the open thread (SOK-1087).
 *
 * Reads its own state: a thread can be opened from a message row, with no
 * thread list loaded, so the panel around it does not know whether this reader
 * muted it. A parent with no replies is not a thread yet and cannot be muted,
 * which is why a failed read leaves no button behind.
 */
export function ThreadMuteButton({
  roomId,
  parentMessageId,
  replyCount,
  onChanged,
}: {
  roomId: string;
  parentMessageId: string;
  /**
   * Replies the panel is showing. A parent with none is not a thread yet, so
   * the read runs again when the first reply lands and the control appears
   * without reopening the panel.
   */
  replyCount: number;
  /** Mute moved this room's unread, so the chrome around it has to re-read. */
  onChanged?: () => void;
}) {
  const t = useTranslations("App.Channels.Thread");
  const threadKey = `${roomId}:${parentMessageId}`;
  const [known, setKnown] = useState<{ key: string; muted: boolean | null }>({
    key: threadKey,
    muted: null,
  });
  // Another thread's answer says nothing about this one.
  const muted = known.key === threadKey ? known.muted : null;
  const [isPending, startTransition] = useTransition();

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

  if (muted === null) {
    return null;
  }

  const label = muted ? t("unmute") : t("mute");

  function handleClick() {
    const next = !muted;
    // Answer the click now; the request only confirms it.
    setKnown({ key: threadKey, muted: next });
    startTransition(async () => {
      try {
        const result = await setThreadMutedAction(
          roomId,
          parentMessageId,
          next,
        );
        if (!result.ok) {
          setKnown({ key: threadKey, muted: !next });
          return;
        }
        setKnown({ key: threadKey, muted: result.value.mutedAt !== null });
        onChanged?.();
      } catch {
        setKnown({ key: threadKey, muted: !next });
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 rounded-full disabled:opacity-100"
      aria-label={label}
      aria-pressed={muted}
      title={label}
      onClick={handleClick}
      disabled={isPending}
      data-testid="thread-panel-mute"
    >
      {muted ? (
        <MegaphoneOff className="size-4" aria-hidden />
      ) : (
        <Megaphone className="size-4" aria-hidden />
      )}
    </Button>
  );
}
