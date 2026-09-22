"use client";

import Ably from "ably";
import Push from "ably/push";

import { getNotificationServiceWorkerUrl } from "@/lib/utils/notification-service-worker";

import { getOrCreateAblyClientInstanceId } from "./ably-client-instance-id";
import { fetchAblyBrowserAuthTokenRequest } from "./auth.client";

/** A fresh SDK device snapshot under the push lock, shared storage across tabs. */
export async function createAblyPushClient(userId: string): Promise<Ably.Rest> {
  const clientInstanceId = getOrCreateAblyClientInstanceId();
  const client = new Ably.Rest({
    plugins: { Push },
    pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
    authCallback: (_params, callback) => {
      void fetchAblyBrowserAuthTokenRequest(clientInstanceId).then(
        (token) => {
          if (token.clientId !== `${userId}:${clientInstanceId}`) {
            callback("Push session changed", null);
            return;
          }
          callback(null, token);
        },
        (error: unknown) =>
          callback(
            error instanceof Error ? error.message : String(error),
            null,
          ),
      );
    },
  });
  await client.auth.authorize();
  return client;
}
