"use client";

import Ably from "ably";
import Push from "ably/push";

import { getNotificationServiceWorkerUrl } from "@/lib/utils/notification-service-worker";

import { getOrCreateAblyClientInstanceId } from "./ably-client-instance-id";
import { reportAblyAuthOk } from "./ably-connection-health-store";
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

function createAblyAuthCallback(
  clientInstanceId: string,
): NonNullable<Ably.AuthOptions["authCallback"]> {
  return (_tokenParams, callback) => {
    void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
      (tokenRequest) => {
        reportAblyAuthOk(true);
        callback(null, tokenRequest);
      },
      (error: unknown) => {
        reportAblyAuthOk(false);
        const status =
          error instanceof AblyBrowserAuthError ? error.status : undefined;
        console.error("Ably auth request failed", { error, status });
        const message = error instanceof Error ? error.message : String(error);
        // Never close() or drop the singleton. close() is terminal for the
        // instance AblyProvider already holds, and clearing the global lets a
        // later island mint a second client with no channels attached. Hand
        // every failure back to ably-js; a real logout unmounts the shell.
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
    pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
  });
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
