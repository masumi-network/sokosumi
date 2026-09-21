import { AtSign } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What the count is a count of.
 *
 * `mention`: the reader was named. Tinted amber, which sets it apart from
 * everything primary around it. A channel's badge, a group Direct's badge and
 * a mentioned Thread row.
 *
 * `unread`: messages. The solid primary pill the badge has always been. A
 * Direct of two, where Core counts every message toward the badge, so amber
 * would say the reader was named when they were only written to.
 */
export type MentionCountTone = "mention" | "unread";

const TONE_CLASS: Record<MentionCountTone, string> = {
  mention: "bg-mention-quaternary text-mention-label",
  unread: "bg-primary-solid text-primary-solid-foreground",
};

/**
 * The count beside a room or a Thread row of what was addressed to the reader.
 *
 * The room badge shares a 28px hole with its row's menu, and these metrics
 * are what fits it: the glyph, its gap and the padding take 20px, which
 * leaves room for one digit. Callers drop the glyph past that. `shrink-0`,
 * so a label that is too wide shows as too wide rather than being squeezed
 * to fit and measured as fitting.
 */
export function MentionCountPill({
  label,
  tone,
  showGlyph,
}: {
  label: string;
  tone: MentionCountTone;
  /** The `@`. Only ever with the `mention` tone. */
  showGlyph: boolean;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex min-w-4.5 shrink-0 items-center justify-center gap-0.5 rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums",
        TONE_CLASS[tone],
      )}
    >
      {showGlyph && tone === "mention" ? (
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
