"use client";

import { useFormatter } from "next-intl";
import { cn } from "@/lib/utils";

/** The last position of the first three results and of the first page. */
const TOP_THREE = 3;
const FIRST_PAGE = 10;

/** Where a Google position stands: in the first three, on the first page, or further down. */
export function seoRankBand(position: number) {
  return position <= TOP_THREE
    ? "top3"
    : position <= FIRST_PAGE
      ? "page1"
      : "rest";
}

/**
 * Gold for the first three, a light fill for the rest of the first page, quiet further down: the strong positions
 * stand out of a column of numbers. Gold is for these three places only; the dark ink reads on it in both themes.
 */
const BAND_CLASS: Record<ReturnType<typeof seoRankBand>, string> = {
  top3: "bg-chart-3 text-primary-foreground",
  page1: "bg-muted text-foreground",
  rest: "text-muted-foreground",
};

/** A Google position as a small pill in the colour of its band. The number says it all; the colour only helps. */
export function SeoRankPill({ position }: { position: number }) {
  const format = useFormatter();
  return (
    <span
      className={cn(
        "inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        BAND_CLASS[seoRankBand(position)],
      )}
    >
      {format.number(position)}
    </span>
  );
}
