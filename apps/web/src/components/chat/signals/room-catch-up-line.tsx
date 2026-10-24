"use client";

import type { ChatCatchUpBucket, ChatRoomCatchUp } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { Sunrise, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { getChatRoomCatchUpAction } from "@/app/chat/signal-actions";
import { CatchUpLine } from "@/components/chat/signals/catch-up-line";
import { RoomSummaryPopover } from "@/components/chat/signals/room-summary-popover";

/** Below this many unread messages a room is read faster than summarised. */
export const BUSY_ROOM_UNREAD = 5;

interface RoomCatchUpLineProps {
  roomId: string;
  /** Unread when the room was opened; the line only shows for a busy room. */
  unreadAtOpen: number;
  /** Puts a message on screen; resolves true once it is there. */
  onJump: (messageId: string) => Promise<boolean>;
}

/**
 * The catch-up line of a busy room: "While you were away: 1 question for
 * you · 2 decisions · 6 FYI". Read once when the room opens and kept for the
 * visit, because reading the room is what empties it. Each segment jumps to
 * its messages in turn; the summary opens the written version.
 */
export function RoomCatchUpLine({
  roomId,
  unreadAtOpen,
  onJump,
}: RoomCatchUpLineProps) {
  const t = useTranslations("App.Channels.Signals");
  const [dismissed, setDismissed] = useState(false);
  const nextIndex = useRef(new Map<ChatCatchUpBucket, number>());
  // Decided once per visit: reading the room drops its unread to zero.
  const [busy] = useState(unreadAtOpen >= BUSY_ROOM_UNREAD);
  const { data } = useQuery({
    queryKey: ["chat-room-catch-up", roomId],
    queryFn: async (): Promise<ChatRoomCatchUp | null> => {
      const result = await getChatRoomCatchUpAction(roomId);
      return result.ok ? result.value : null;
    },
    enabled: busy,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!busy || dismissed || !data || data.buckets.length === 0) return null;

  function handleSelect(bucket: ChatCatchUpBucket) {
    const ids = data?.buckets.find(
      (entry) => entry.bucket === bucket,
    )?.messageIds;
    if (!ids || ids.length === 0) return;
    const index = nextIndex.current.get(bucket) ?? 0;
    nextIndex.current.set(bucket, (index + 1) % ids.length);
    void onJump(ids[index]);
  }

  return (
    <div
      data-testid="room-catch-up-line"
      className="text-muted-foreground mb-1.5 flex min-w-0 items-center gap-2 px-1 text-sm"
    >
      <Sunrise className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <span className="me-1.5">{t("whileYouWereAway")}</span>
        <CatchUpLine buckets={data.buckets} onSelect={handleSelect} />
      </p>
      <RoomSummaryPopover roomId={roomId} onJump={onJump} />
      <button
        type="button"
        aria-label={t("dismissCatchUp")}
        title={t("dismissCatchUp")}
        className="hit-area hover:text-foreground grid size-6 shrink-0 place-items-center rounded-md"
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
