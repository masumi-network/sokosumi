"use client";

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
      <span className="text-muted-foreground bg-muted-foreground/10 rounded-full px-3 py-1 text-xs font-medium">
        {localCalendarReady ? formatDaySeparator(date) : "\u00a0"}
      </span>
    </div>
  );
}
