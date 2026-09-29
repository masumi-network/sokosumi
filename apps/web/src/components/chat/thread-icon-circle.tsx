import { AtSign, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How loudly the mark reads.
 *
 * `attention` is the product's unread language — the tinted circle the
 * notification rows and the Thread list's Unread group use. `quiet` is the
 * neutral circle the sidebar's inset rows use for a plain unread Thread, so a
 * long list under a room does not turn primary; there the tint is reserved for
 * a Thread that names the reader. `read` drops the circle entirely.
 */
export type ThreadIconCircleTone = "attention" | "quiet" | "read";

/** `sm` sits on a sidebar row, `md` on the Thread list panel's roomier row. */
export type ThreadIconCircleSize = "sm" | "md";

interface ThreadIconCircleProps {
  tone: ThreadIconCircleTone;
  /** `mention` draws the `@`, for a Thread a reply in it named the reader in. */
  glyph?: "thread" | "mention";
  size?: ThreadIconCircleSize;
  className?: string;
}

const TONE_CLASS: Record<ThreadIconCircleTone, string> = {
  attention: "bg-primary-quaternary text-primary-variant",
  quiet: "bg-sidebar-accent text-muted-foreground",
  read: "text-muted-foreground",
};

const SIZE_CLASS: Record<ThreadIconCircleSize, string> = {
  sm: "size-[1.125rem]",
  md: "size-6",
};

const GLYPH_CLASS: Record<ThreadIconCircleSize, string> = {
  sm: "size-[0.6875rem]",
  md: "size-3.5",
};

/**
 * The mark that says whether a Thread has anything new in it.
 *
 * One piece for the sidebar's inset rows and the room's Thread list panel:
 * both draw the same circle, and lifting it here is what keeps the two from
 * drifting apart as either surface is restyled (SOK-1158).
 *
 * Always `aria-hidden`: every row that draws one already says in text what the
 * mark means ("2 new", "1 mention"), so announcing it twice only adds noise.
 */
export function ThreadIconCircle({
  tone,
  glyph = "thread",
  size = "sm",
  className,
}: ThreadIconCircleProps) {
  const Glyph = glyph === "mention" ? AtSign : MessageSquare;
  return (
    <span
      aria-hidden="true"
      data-testid="thread-icon-circle"
      data-slot="thread-icon-circle"
      data-tone={tone}
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      )}
    >
      <Glyph className={GLYPH_CLASS[size]} />
    </span>
  );
}
