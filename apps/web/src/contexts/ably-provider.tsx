"use client";

import { AblyProvider as DefaultAblyProvider } from "ably/react";

import { getAblyRealtimeClient } from "@/lib/ably/realtime-singleton.client";

interface AblyProviderProps {
  children: React.ReactNode;
}

export default function AblyProvider({ children }: AblyProviderProps) {
  const client = getAblyRealtimeClient();

  return <DefaultAblyProvider client={client}>{children}</DefaultAblyProvider>;
}
