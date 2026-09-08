"use client";

import Ably from "ably";
import Push from "ably/push";

import { NOTIFICATION_SERVICE_WORKER_URL } from "@/lib/utils/notification-service-worker";

import { getOrCreateAblyClientInstanceId } from "./ably-client-instance-id";
import {
  AblyBrowserAuthError,
  fetchAblyBrowserAuthTokenRequest,
} from "./auth.client";

declare global {
  var __sokosumiAblyRealtimeClient: Ably.Realtime | undefined;
}

function getGlobalAblyRealtimeClient(): Ably.Realtime | undefined {
  return globalThis.__sokosumiAblyRealtimeClient;
}

function setGlobalAblyRealtimeClient(client: Ably.Realtime): void {
  globalThis.__sokosumiAblyRealtimeClient = client;
}

function clearSharedAblyRealtimeClient(): void {
  const existing = getGlobalAblyRealtimeClient();
  globalThis.__sokosumiAblyRealtimeClient = undefined;
  existing?.close();
}

function createAblyAuthCallback(
  clientInstanceId: string,
): NonNullable<Ably.AuthOptions["authCallback"]> {
  return (_tokenParams, callback) => {
    void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
      (tokenRequest) => {
        callback(null, tokenRequest);
      },
      (error: unknown) => {
        if (error instanceof AblyBrowserAuthError && error.status === 401) {
          clearSharedAblyRealtimeClient();
        } else {
          console.error("Ably auth request failed", error);
        }
        const message = error instanceof Error ? error.message : String(error);
        callback(message, null);
      },
    );
  };
}

export function getAblyRealtimeClient(): Ably.Realtime {
  const existingClient = getGlobalAblyRealtimeClient();
  if (existingClient) {
    return existingClient;
  }

  const clientInstanceId = getOrCreateAblyClientInstanceId();
  const realtimeClient = new Ably.Realtime({
    authCallback: createAblyAuthCallback(clientInstanceId),
    echoMessages: false,
    // Plugins are constructor-only in ably-js, so push rides the shared client
    // rather than a second one. Every route reaches this module through a
    // dynamic import (`contexts/lazy-ably-provider.tsx` for realtime,
    // `loadPushActivation` for the account page), so the SDK stays out of
    // the bundles that never use it.
    plugins: { Push },
    pushServiceWorkerUrl: NOTIFICATION_SERVICE_WORKER_URL,
  });
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
