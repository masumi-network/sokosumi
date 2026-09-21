import { AtSign } from "lucide-react";

import { roomCountLabel } from "@/components/chat/room-count-label";
import { cn } from "@/lib/utils";

/**
 * What the count is a count of.
 *
 * `mention`: the reader was named. Tinted amber with an `@`, always both:
 * amber without the glyph reads as some third kind of count. A channel's
 * badge, a group Direct's badge and a mentioned Thread row.
 *
 * `unread`: messages that are the reader's, where nobody named them. The same
 * pill tinted primary: a Direct of two, where Core counts every message toward
 * the badge, and a Thread row's unread replies. One shape for both, because
 * both say the same thing; amber there would claim the reader was named.
 */
export type MentionCountTone = "mention" | "unread";

/**
 * The highest mention count shown as itself. The room badge shares a 28px
 * hole with its row's menu, and the `@` takes its share of it, so past this
 * it is the number that gives way: `@ 9+`. Ten unread mentions in one room is
 * rare, and an exact `12` is not worth a badge the reader cannot decode.
 */
const MENTION_COUNT_CAP = 9;

const TONE_CLASS: Record<MentionCountTone, string> = {
  // Tighter than `unread`: the glyph has to fit the same hole.
  mention: "bg-mention-quaternary text-mention-label gap-px px-[0.1875rem]",
  unread: "bg-primary-quaternary text-primary px-1",
};

/**
 * The count beside a room or a Thread row of what was addressed to the reader.
 *
 * `shrink-0`, so a label too wide for the room badge's hole shows as too wide
 * rather than being squeezed to fit and measured as fitting.
 */
export function MentionCountPill({
  count,
  tone,
}: {
  count: number;
  tone: MentionCountTone;
}) {
  const label =
    tone === "mention"
      ? count > MENTION_COUNT_CAP
        ? `${MENTION_COUNT_CAP}+`
        : String(count)
      : roomCountLabel(count);

  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full text-[0.625rem] leading-4 font-semibold tabular-nums",
        TONE_CLASS[tone],
      )}
    >
      {tone === "mention" ? (
        <AtSign
          data-slot="mention-glyph"
          aria-hidden
          className="size-2 shrink-0"
        />
      ) : null}
      {label}
    </span>
  );
}
