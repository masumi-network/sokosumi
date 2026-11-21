"use client";

import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import {
  type UseCalendarRealtimeOptions,
  useCalendarRealtime,
} from "@/hooks/effects/use-calendar-realtime";

type CalendarRealtimeBridgeProps = UseCalendarRealtimeOptions;

function CalendarRealtimeSubscription(props: CalendarRealtimeBridgeProps) {
  useCalendarRealtime(props);
  return null;
}

export function CalendarRealtimeBridge(props: CalendarRealtimeBridgeProps) {
  return (
    <LazyAblyProvider>
      <CalendarRealtimeSubscription {...props} />
    </LazyAblyProvider>
  );
}
