"use client";

import { AblyProvider as DefaultAblyProvider } from "ably/react";
import { useSyncExternalStore } from "react";

import {
  getAblyRealtimeClient,
  subscribeToAblyRealtimeClient,
} from "@/lib/ably/realtime-singleton.client";

interface AblyProviderProps {
  children: React.ReactNode;
}

/**
 * Reading the client once per render is not enough: a token minted for a
 * different user retires the client, and a provider holding the closed
 * instance would stay silent with no channels for the rest of the page's
 * life. Subscribing lets the retire rebuild the tree around a working client.
 * The snapshot is stable — `getAblyRealtimeClient()` returns the same instance
 * until a retire drops it.
 */
export default function AblyProvider({ children }: AblyProviderProps) {
  const client = useSyncExternalStore(
    subscribeToAblyRealtimeClient,
    getAblyRealtimeClient,
    getAblyRealtimeClient,
  );

  return <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>;
}
