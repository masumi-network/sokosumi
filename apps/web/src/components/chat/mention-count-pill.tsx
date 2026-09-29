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
 * named: tinted primary with an `@`, the one spot of colour on a row, matching
 * the collapsed rail's mention pill. A row draws one or the other.
 *
 * `text-primary-variant`, not `text-primary`: on the `-quaternary` tint in
 * dark mode `--primary` measures 3.83:1, under the 4.5:1 floor for text this
 * small (`globals.css` records the pair). `-variant` is that ramp's lighter
 * step, 4.91:1 there, and equals `--primary` in light mode, 5.49:1. The Soko
 * Bot status badge already pairs the two the same way.
 *
 * `shrink-0`, so a label too wide for the room's hole shows as too wide rather
 * than being squeezed to fit and measured as fitting.
 */
export function MentionCountPill({ count }: { count: number }) {
  return (
    <span
      data-slot="mention-pill"
      className="bg-primary-quaternary text-primary-variant inline-flex min-w-4.5 shrink-0 items-center justify-center gap-px rounded-full px-[0.1875rem] text-[0.625rem] leading-4 font-semibold tabular-nums"
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
 * A row's one drawn number (the one-number rule, SOK-1147): the `@` pill
 * where the reader was named, the muted count otherwise, nothing at zero.
 * Draws only; each row states the number in words for assistive technology,
 * because what it counts differs from row to row.
 */
export function RowCountMark({
  mentionCount,
  count,
}: {
  mentionCount: number;
  count: number;
}) {
  if (mentionCount > 0) {
    return <MentionCountPill count={mentionCount} />;
  }
  if (count <= 0) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-[0.625rem] leading-4 font-semibold tabular-nums">
      {roomCountLabel(count)}
    </span>
  );
}
