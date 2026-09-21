import { AtSign } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The count of what was addressed to the reader, as a tinted amber pill.
 *
 * Amber sets it apart from everything primary-tinted around it, which is
 * plain unread. The `@` says the count is mentions. A channel's badge, a
 * group Direct's badge and a Thread row show it. A Direct of two does not:
 * every message there is addressed to the reader, so its count is messages.
 *
 * The room badge shares a 28px hole with its row's menu, and these metrics
 * are what fits it. Callers drop the glyph where the label is too wide.
 */
export function MentionCountPill({
  label,
  showGlyph,
  className,
}: {
  label: string;
  showGlyph: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-semantic-warning-quaternary text-semantic-warning-label inline-flex min-w-4.5 items-center justify-center gap-0.5 rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums",
        className,
      )}
    >
      {showGlyph ? (
        <AtSign
          data-slot="mention-glyph"
          aria-hidden
          className="size-2.5 shrink-0"
        />
      ) : null}
      {label}
    </span>
  );
}
