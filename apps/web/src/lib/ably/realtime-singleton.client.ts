"use client";

import Ably from "ably";
import Push from "ably/push";

import { getNotificationServiceWorkerUrl } from "@/lib/utils/notification-service-worker";

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

/**
 * Never close the client here.
 *
 * A 401 from `/api/ably/auth` used to mean "the session is gone", so this
 * closed the shared client. `close()` is terminal and nothing re-creates the
 * instance the mounted provider holds, so chat notifications stayed dead until
 * a full page reload. The 401 was often not a logout at all: a Core session
 * read that timed out was reported as one. Hand every failure back to ably-js
 * instead and let it retry — a real logout ends the session on its own.
 */
function createAblyAuthCallback(
  clientInstanceId: string,
): NonNullable<Ably.AuthOptions["authCallback"]> {
  return (_tokenParams, callback) => {
    void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
      (tokenRequest) => {
        callback(null, tokenRequest);
      },
      (error: unknown) => {
        console.error("Ably auth request failed", {
          status: error instanceof AblyBrowserAuthError ? error.status : null,
          error,
        });
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
    pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
  });
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
