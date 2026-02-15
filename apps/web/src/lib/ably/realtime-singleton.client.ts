"use client";

import Ably from "ably";

declare global {
  var __sokosumiAblyRealtimeClient: Ably.Realtime | undefined;
}

function getGlobalAblyRealtimeClient(): Ably.Realtime | undefined {
  return globalThis.__sokosumiAblyRealtimeClient;
}

function setGlobalAblyRealtimeClient(client: Ably.Realtime): void {
  globalThis.__sokosumiAblyRealtimeClient = client;
}

export function getAblyRealtimeClient(): Ably.Realtime {
  const existingClient = getGlobalAblyRealtimeClient();
  if (existingClient) {
    return existingClient;
  }

  const realtimeClient = new Ably.Realtime({
    authUrl: "/api/ably/auth",
    authMethod: "POST",
  });
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
