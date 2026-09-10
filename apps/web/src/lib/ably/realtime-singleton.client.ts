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
 * Mounted providers read the client once per render, so a retire alone leaves
 * them holding a closed instance. Identity changes notify these listeners so
 * the tree rebuilds; a lost session deliberately does not, and also keeps the
 * global, because rebuilding for a signed-out browser only restarts the polling
 * the retire just stopped.
 */
const clientListeners = new Set<() => void>();

export function subscribeToAblyRealtimeClient(
  listener: () => void,
): () => void {
  clientListeners.add(listener);
  return () => {
    clientListeners.delete(listener);
  };
}

/**
 * A signed-out browser answers 401 forever. ably-js treats our auth failure as
 * non-terminal and re-runs the callback on its 15s/30s backoff, so a tab left
 * open after a logout would poll `/api/ably/auth` for the life of the page.
 * Allow a few failures — one 401 can still be a blip — then end the client.
 */
const MAX_CONSECUTIVE_SESSION_LOSSES = 3;

/**
 * Ends one client. Only for failures that no retry can clear: a lost session,
 * or a token minted for a different user.
 *
 * `rebuild` governs the global, not just the listeners. `getAblyRealtimeClient`
 * constructs whenever the global is empty, so dropping the global is itself the
 * rebuild: the next render of any mounted provider builds a client, listener or
 * no listener. A lost session must therefore leave the retired client in place.
 * Clearing it there would build a fresh client that 401s its way to the same
 * retire, which drops the global again, for the life of the tab.
 *
 * Takes the client the caller owns rather than reading the global, because a
 * callback can settle long after its own client was retired: closing whatever
 * happens to be global then would kill a healthy replacement.
 */
function retireAblyRealtimeClient(
  client: Ably.Realtime | undefined,
  options?: { rebuild?: boolean },
): void {
  if (!client) {
    return;
  }
  if (options?.rebuild && getGlobalAblyRealtimeClient() === client) {
    setGlobalAblyRealtimeClient(undefined);
  }
  client.close();
  if (options?.rebuild) {
    for (const listener of clientListeners) {
      listener();
    }
  }
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
 * `retireAblyRealtimeClient`. Only the identity change drops the global, so
 * that a client for the new user can be built.
 */
function createAblyAuthCallback(
  clientInstanceId: string,
  owner: { client?: Ably.Realtime },
): NonNullable<Ably.AuthOptions["authCallback"]> {
  let issuedClientId: string | undefined;
  let consecutiveSessionLosses = 0;
  let retired = false;

  return (_tokenParams, callback) => {
    void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
      (tokenRequest) => {
        if (retired) {
          callback("Ably client retired", null);
          return;
        }
        reportAblyAuthOk(true);
        consecutiveSessionLosses = 0;

        // Core mints `${userId}:${clientInstanceId}`, so a changed clientId
        // means a different user signed in to this tab. ably-js refuses a
        // token that contradicts the one the client already latched (40102)
        // and fails the connection terminally, so retire the client and have
        // the mounted providers build one for the new identity.
        if (
          tokenRequest.clientId !== undefined &&
          issuedClientId !== undefined &&
          tokenRequest.clientId !== issuedClientId
        ) {
          retired = true;
          retireAblyRealtimeClient(owner.client, { rebuild: true });
          callback("Ably auth identity changed", null);
          return;
        }

        issuedClientId = tokenRequest.clientId ?? issuedClientId;
        callback(null, tokenRequest);
      },
      (error: unknown) => {
        const status =
          error instanceof AblyBrowserAuthError ? error.status : undefined;
        console.error("Ably auth request failed", { error, status });

        const message = error instanceof Error ? error.message : String(error);
        // A retired client is closed; its health no longer describes the page.
        if (retired) {
          callback(message, null);
          return;
        }
        reportAblyAuthOk(false);

        // Only Core's own 401 proves the session is gone. `/api/ably/auth`
        // answers 503 for its own budget expiring and 502 for anything else,
        // so this counter never runs on an outage.
        consecutiveSessionLosses =
          status === 401 ? consecutiveSessionLosses + 1 : 0;
        if (consecutiveSessionLosses >= MAX_CONSECUTIVE_SESSION_LOSSES) {
          retired = true;
          retireAblyRealtimeClient(owner.client);
        }

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
  // The callback needs the client it belongs to, and ably-js takes the
  // callback in the constructor, so the owner is filled in right after.
  const owner: { client?: Ably.Realtime } = {};
  const realtimeClient = new Ably.Realtime({
    authCallback: createAblyAuthCallback(clientInstanceId, owner),
    echoMessages: false,
    // Plugins are constructor-only in ably-js, so push rides the shared client
    // rather than a second one. Every route reaches this module through a
    // dynamic import (`contexts/lazy-ably-provider.tsx` for realtime,
    // `loadPushActivation` for the account page), so the SDK stays out of
    // the bundles that never use it.
    plugins: { Push },
    pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
  });
  owner.client = realtimeClient;
  setGlobalAblyRealtimeClient(realtimeClient);
  return realtimeClient;
}
