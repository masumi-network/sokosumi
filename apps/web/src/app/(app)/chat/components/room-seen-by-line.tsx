"use client";

import { useTranslations } from "next-intl";

import type {
  RoomReader,
  RoomReadReceipts,
} from "@/app/chat/hooks/use-room-read-receipts";
import { ReadReceiptFaces } from "@/components/chat/read-receipt-avatar-stack";

/**
 * Which readers a message shows — the newest message in the transcript, and
 * nothing anywhere else.
 *
 * The rule lives here rather than inside the component because the transcript
 * has to know the answer before it renders: an empty answer means no trailing
 * slot and no reserved gutter, and asking twice in two places is how the two
 * drift apart. The data would answer this for any message; a row of faces
 * under every one of them is scrollback noise.
 */
export function seenByReadersFor({
  readersAsOf,
  messageId,
  createdAt,
  newestMessageId,
}: {
  readersAsOf: RoomReadReceipts["readersAsOf"];
  messageId: string;
  createdAt: Date | string;
  newestMessageId: string | null;
}): readonly RoomReader[] {
  if (messageId !== newestMessageId) {
    return [];
  }
  return readersAsOf(createdAt);
}

interface RoomSeenByLineProps {
  /** Readers as of this message, most-recent-read first, viewer excluded. */
  readers: readonly RoomReader[];
}

/**
 * Seen by — the faces ride the end of the message's last line.
 *
 * Trailing the text rather than sitting on a row of its own, so the newest
 * message is exactly as tall as every other one. The transcript reserves the
 * width these faces need, so the last words wrap early instead.
 *
 * Faces rather than a number: at this size the count is still legible from the
 * `+N`, and a face says *who* without spending a line of copy on it. They are
 * the same faces, cap and order as the header stack, so the two surfaces never
 * disagree. Inert — the header stack owns the detail and the keyboard path.
 *
 * Nothing renders when nobody has read that far: a guest sees no read times,
 * and an empty tail would report a boundary as a snub.
 */
export function RoomSeenByLine({ readers }: RoomSeenByLineProps) {
  const t = useTranslations("App.Channels.SeenBy");

  if (readers.length === 0) {
    return null;
  }

  return (
    <span
      className="ms-1.5 inline-flex align-middle"
      // One named graphic: the faces mean nothing one at a time, and without a
      // role a labelled span is simply skipped.
      role="img"
      aria-label={t("summary", { count: readers.length })}
      title={t("summary", { count: readers.length })}
      data-testid="room-seen-by-line"
    >
      <ReadReceiptFaces readers={readers} size="sm" />
    </span>
  );
}
