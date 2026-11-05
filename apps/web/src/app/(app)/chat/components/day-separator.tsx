"use client";

import type { ReactNode } from "react";

import { useClientLocalCalendarReady } from "@/app/chat/hooks/use-client-local-calendar-ready";

interface DaySeparatorProps {
  date: Date;
  formatDaySeparator: (date: Date) => string;
}

/**
 * Day labels ("Today", weekday, dd/mm/yyyy) depend on the runtime's local
 * calendar and "now". SSR (UTC on Vercel) disagrees with the browser — that
 * mismatched text was Sentry SOKOSUMI-A (`Today` vs `Thursday`). Render a
 * stable empty shell until the client calendar is ready.
 */
export default function DaySeparator({
  date,
  formatDaySeparator,
}: DaySeparatorProps) {
  const localCalendarReady = useClientLocalCalendarReady();

  return (
    <div className="flex items-center justify-center pt-2 pb-1">
      <DayPill>
        {localCalendarReady ? formatDaySeparator(date) : "\u00a0"}
      </DayPill>
    </div>
  );
}

interface DayPillProps {
  children: ReactNode;
}

/** The day label's pill, shared with the Unread divider. */
export function DayPill({ children }: DayPillProps) {
  return (
    <span className="text-muted-foreground bg-senary rounded-full px-3 py-1 text-xs font-medium">
      {children}
    </span>
  );
}
