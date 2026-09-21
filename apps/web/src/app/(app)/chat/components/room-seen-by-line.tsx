"use client";

import { useTranslations } from "next-intl";

import type { RoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";

interface RoomSeenByLineProps {
  /** Room read receipts for the open room. */
  countReadAsOf: RoomReadReceipts["countReadAsOf"];
  /** The message this line sits under. */
  createdAt: Date | string;
  /** Only the newest message in the transcript carries the line. */
  isNewest: boolean;
}

/**
 * Seen by N under the newest message — reach at a glance, without opening a
 * panel. The count is client arithmetic over the receipts the room payload
 * already carried, so this surface costs the server nothing.
 *
 * Under the newest message only. The data would answer the question for any
 * message, but a line under every one of them is scrollback noise.
 *
 * Nothing renders at zero: a guest sees no read times, and "Seen by 0" would
 * report a boundary as a snub.
 */
export function RoomSeenByLine({
  countReadAsOf,
  createdAt,
  isNewest,
}: RoomSeenByLineProps) {
  const t = useTranslations("App.Channels.SeenBy");

  if (!isNewest) {
    return null;
  }

  const count = countReadAsOf(createdAt);
  if (count === 0) {
    return null;
  }

  return (
    <p
      className="text-muted-foreground mt-1 text-xs"
      data-testid="room-seen-by-line"
    >
      {t("transcript", { count })}
    </p>
  );
}
