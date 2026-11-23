"use client";

import { Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useThreadMuteStatus } from "@/hooks/effects/use-thread-mute-status";

import { setThreadMutedAction } from "../actions";

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
  const { muted, setThreadMuted } = useThreadMuteStatus(
    roomId,
    parentMessageId,
    replyCount,
  );
  const [isPending, startTransition] = useTransition();

  if (muted === null) {
    return null;
  }

  const label = muted ? t("unmute") : t("mute");

  function handleClick() {
    const next = !muted;
    // Answer the click now; the request only confirms it.
    setThreadMuted(next);
    startTransition(async () => {
      try {
        const result = await setThreadMutedAction(
          roomId,
          parentMessageId,
          next,
        );
        if (!result.ok) {
          setThreadMuted(!next);
          return;
        }
        setThreadMuted(result.value.mutedAt !== null);
        onChanged?.();
      } catch {
        setThreadMuted(!next);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 md:size-8 rounded-full disabled:opacity-100"
      aria-label={label}
      aria-pressed={muted}
      title={label}
      onClick={handleClick}
      disabled={isPending}
      data-testid="thread-panel-mute"
    >
      {/* The bell, as on a muted room: a megaphone is the Announcement tag. */}
      {muted ? (
        <BellOff className="size-4" aria-hidden />
      ) : (
        <Bell className="size-4" aria-hidden />
      )}
    </Button>
  );
}
