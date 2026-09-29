import { ArrowDown, ArrowUp } from "lucide-react";

import type { ActivityStat } from "./landing-content";

/** Muted arrow + delta after a chip label. Deliberately colourless. */
export function ActivityTrend({ trend }: { trend: ActivityStat["trend"] }) {
  if (!trend) {
    return null;
  }
  const Arrow = trend.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="text-muted-foreground ml-1.5 inline-flex items-center">
      <Arrow aria-hidden className="size-3" />
      {trend.delta}
      <span className="sr-only">{trend.label}</span>
    </span>
  );
}
