import { AtSign } from "lucide-react";

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
 * named: a primary `@` and count in a hairline ring, the one spot of colour
 * on a row, the same shape and hue as the collapsed rail's mention pill. A
 * row draws one or the other.
 *
 * An outline rather than a fill. Beside a bare muted count a filled pill of
 * the same size read as the heavier of the two, when the two are meant to be
 * one family with one of them named. The ring keeps the badge shape at about
 * half the weight. The ring is the text's own colour: the ramp's border
 * step, `-tertiary`, measures 1.5:1 on the sidebar ground, a boundary the
 * eye would lose, where `-variant` measures 6:1 dark and 6.9:1 light.
 *
 * `text-primary-variant`, not `text-primary`: the text sits on the sidebar
 * ground, where `--primary` is 4.71:1 in dark mode, but on the row's hover
 * fill it drops under the 4.5:1 floor for text this small; `-variant` is
 * that ramp's lighter step and equals `--primary` in light mode. The Soko
 * Bot status badge pairs the same tokens.
 *
 * The ring takes 1px a side, so the padding gives it back: "@ 9+" has to
 * stay inside the room row's 28px hole.
 *
 * `shrink-0`, so a label too wide for the room's hole shows as too wide rather
 * than being squeezed to fit and measured as fitting.
 */
export function MentionCountPill({ count }: { count: number }) {
  return (
    <span
      data-slot="mention-pill"
      data-shape="outline"
      className="border-primary-variant text-primary-variant inline-flex min-w-4.5 shrink-0 items-center justify-center gap-px rounded-full border px-[0.125rem] text-[0.625rem] leading-4 font-semibold tabular-nums"
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
