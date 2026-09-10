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

function setGlobalAblyRealtimeClient(client: Ably.Realtime | undefined): void {
  globalThis.__sokosumiAblyRealtimeClient = client;
}

/**
 * A signed-out browser answers 401 forever. ably-js treats our auth failure as
 * non-terminal and re-runs the callback on its 15s/30s backoff, so a tab left
 * open after a logout would poll `/api/ably/auth` for the life of the page.
 * Allow a few failures — one 401 can still be a blip — then end the client.
 */
const MAX_CONSECUTIVE_SESSION_LOSSES = 3;

/**
 * Ends the shared client and drops the global so the next provider mount
 * builds a fresh one. Only for failures that no retry can clear: a lost
 * session, or a token minted for a different user.
 */
function retireSharedAblyRealtimeClient(): void {
  const client = getGlobalAblyRealtimeClient();
  setGlobalAblyRealtimeClient(undefined);
  client?.close();
}

/**
 * Hand a failure back to ably-js and let it retry. Do not close the client for
 * one bad answer.
 *
 * Any 401 from `/api/ably/auth` used to close the shared client. `close()` is
 * terminal and nothing re-creates the instance the mounted provider holds, so
 * chat notifications stayed dead until a full page reload — and the 401 was
 * often not a logout at all, because a Core session read that timed out was
 * reported as one. The two cases that no retry can clear (a session that stays
 * gone, and a token for a different user) retire the client through
 * `retireSharedAblyRealtimeClient`, which also drops the global so the next
 * mount can build a working one.
 */
function createAblyAuthCallback(
  clientInstanceId: string,
): NonNullable<Ably.AuthOptions["authCallback"]> {
  let issuedClientId: string | undefined;
  let consecutiveSessionLosses = 0;

  return (_tokenParams, callback) => {
    void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
      (tokenRequest) => {
        reportAblyAuthOk(true);
        consecutiveSessionLosses = 0;

        // Core mints `${userId}:${clientInstanceId}`, so a changed clientId
        // means a different user signed in to this tab. ably-js refuses a
        // token that contradicts the one the client already latched (40102)
        // and fails the connection terminally, so retire the client instead
        // and let the next mount build one for the new identity.
        if (
          tokenRequest.clientId !== undefined &&
          issuedClientId !== undefined &&
          tokenRequest.clientId !== issuedClientId
        ) {
          retireSharedAblyRealtimeClient();
          callback("Ably auth identity changed", null);
          return;
        }

        issuedClientId = tokenRequest.clientId ?? issuedClientId;
        callback(null, tokenRequest);
      },
      (error: unknown) => {
        reportAblyAuthOk(false);
        const status =
          error instanceof AblyBrowserAuthError ? error.status : undefined;
        console.error("Ably auth request failed", { error, status });

        // Only Core's own 401 proves the session is gone (`/api/ably/auth`
        // answers 502 for a timeout or any other failure), so this counter
        // never runs on an outage.
        consecutiveSessionLosses =
          status === 401 ? consecutiveSessionLosses + 1 : 0;
        if (consecutiveSessionLosses >= MAX_CONSECUTIVE_SESSION_LOSSES) {
          retireSharedAblyRealtimeClient();
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
    pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
  });
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
