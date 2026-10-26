"use client";

import type { ChatCatchUpBucket } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

/** Buckets small talk never makes it into a catch-up line. */
const QUIET_BUCKETS: readonly ChatCatchUpBucket[] = ["chitChat"];

/** How many buckets a line names before it stops; the rest is in the room. */
const MAX_SEGMENTS = 4;

interface CatchUpLineProps {
  buckets: readonly { bucket: ChatCatchUpBucket; count: number }[];
  /** Makes each segment a button; without it the line is plain text. */
  onSelect?: (bucket: ChatCatchUpBucket) => void;
  className?: string;
}

/**
 * "1 question for you · 2 decisions · 6 FYI": what is unread, by what Jev
 * read in it, most pressing first. Core already orders the buckets. What
 * needs the reader takes the primary tint, the one colour on the line.
 */
export function CatchUpLine({
  buckets,
  onSelect,
  className,
}: CatchUpLineProps) {
  const t = useTranslations("App.Channels.Signals.Buckets");
  const shown = buckets
    .filter((entry) => !QUIET_BUCKETS.includes(entry.bucket))
    .slice(0, MAX_SEGMENTS);
  if (shown.length === 0) return null;

  return (
    <span className={cn("text-sm", className)}>
      {shown.map((entry, index) => {
        const label = t(entry.bucket, { count: entry.count });
        const tone =
          entry.bucket === "needsYou"
            ? "text-primary-variant font-medium"
            : "text-foreground";
        return (
          <Fragment key={entry.bucket}>
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground px-1.5">
                ·
              </span>
            ) : null}
            {onSelect ? (
              <button
                type="button"
                className={cn(
                  tone,
                  "rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none",
                )}
                data-bucket={entry.bucket}
                onClick={() => onSelect(entry.bucket)}
              >
                {label}
              </button>
            ) : (
              <span className={tone}>{label}</span>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
