"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

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
  const [override, setOverride] = useState<{
    key: string;
    muted: boolean;
  } | null>(null);
  const [resolved, setResolved] = useState<{
    key: string;
    muted: boolean;
  } | null>(null);
  // Another thread's answer says nothing about this one.
  const knownMuted =
    override?.key === threadKey
      ? override.muted
      : resolved?.key === threadKey
        ? resolved.muted
        : null;
  const [isPending, startTransition] = useTransition();

  // Only read while the state is unknown. A reply landing mid-toggle must
  // not race the write it would overtake.
  const threadQuery = useQuery({
    queryKey: ["chat", "thread-mute", roomId, parentMessageId, replyCount],
    queryFn: async () => {
      const result = await getRoomThreadAction(roomId, parentMessageId);
      if (!result.ok) {
        throw new Error(result.error.message ?? undefined);
      }
      return result.value.mutedAt !== null;
    },
    enabled: knownMuted === null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (
    knownMuted === null &&
    threadQuery.data !== undefined &&
    resolved?.key !== threadKey
  ) {
    setResolved({ key: threadKey, muted: threadQuery.data });
  }

  const muted = knownMuted ?? threadQuery.data ?? null;

  if (muted === null) {
    return null;
  }

  const label = muted ? t("unmute") : t("mute");

  function handleClick() {
    const next = !muted;
    // Answer the click now; the request only confirms it.
    setOverride({ key: threadKey, muted: next });
    startTransition(async () => {
      try {
        const result = await setThreadMutedAction(
          roomId,
          parentMessageId,
          next,
        );
        if (!result.ok) {
          setOverride({ key: threadKey, muted: !next });
          return;
        }
        setOverride({ key: threadKey, muted: result.value.mutedAt !== null });
        onChanged?.();
      } catch {
        setOverride({ key: threadKey, muted: !next });
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
