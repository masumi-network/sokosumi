import { AtSign } from "lucide-react";

import { roomCountLabel } from "@/components/chat/room-count-label";

/**
 * The highest mention count shown as itself. The room's pill shares a 28px
 * hole with its row's menu, and the `@` takes its share of it, so past this
 * it is the number that gives way: `@ 9+`. Ten unread mentions in one room is
 * rare, and an exact `12` is not worth dropping the glyph that says what the
 * number counts.
 */
const MENTION_COUNT_CAP = 9;

/**
 * How many times the reader was named, beside a room or a Thread row.
 *
 * The sidebar has two marks. A muted number says how much is unread, the same
 * way for a channel, a Direct and a Thread. This pill says the reader was
 * named: tinted primary with an `@`, the one spot of colour on a row. A row
 * draws one or the other.
 *
 * The number is `text-foreground`: the primary is a fill, never text, so the
 * tint carries the colour and the label stays readable on it in both modes.
 *
 * `shrink-0`, so a label too wide for the room's hole shows as too wide rather
 * than being squeezed to fit and measured as fitting.
 */
export function MentionCountPill({ count }: { count: number }) {
  return (
    <span
      data-slot="mention-pill"
      className="bg-quinary text-foreground inline-flex min-w-4.5 shrink-0 items-center justify-center gap-px rounded-full px-[0.1875rem] text-2xs leading-4 font-semibold tabular-nums"
    >
      <AtSign
        data-slot="mention-glyph"
        aria-hidden
        className="size-2 shrink-0"
      />
      {count > MENTION_COUNT_CAP ? `${MENTION_COUNT_CAP}+` : count}
    </span>
  );
}

/**
 * How many unread messages wait on the reader: a question or a decision Jev
 * read as addressed to them. Solid primary, the loudest mark a row can draw,
 * because it outranks being named: the `@` pill says the reader was
 * mentioned, this says someone is waiting on them. Same size as the `@` pill
 * so the two share the room's hole.
 */
export function NeedsYouPill({ count }: { count: number }) {
  return (
    <span
      data-slot="needs-you-pill"
      className="bg-primary text-primary-foreground inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-2xs leading-4 font-semibold tabular-nums"
    >
      {count > MENTION_COUNT_CAP ? `${MENTION_COUNT_CAP}+` : count}
    </span>
  );
}

/**
 * A row's one drawn number (the one-number rule, SOK-1147): the `@` pill
 * where the reader was named, the muted count otherwise, nothing at zero.
 * Draws only; each row states the number in words for assistive technology,
 * because what it counts differs from row to row.
 */
export function RowCountMark({
  mentionCount,
  count,
  needsYouCount = 0,
}: {
  mentionCount: number;
  count: number;
  /** Wins over the `@` pill: waited on outranks named. */
  needsYouCount?: number;
}) {
  if (needsYouCount > 0) {
    return <NeedsYouPill count={needsYouCount} />;
  }
  if (mentionCount > 0) {
    return <MentionCountPill count={mentionCount} />;
  }
  if (count <= 0) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-2xs leading-4 font-semibold tabular-nums">
      {roomCountLabel(count)}
    </span>
  );
}
