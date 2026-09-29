"use client";

import type Ably from "ably";
import * as z from "zod";

import { getExistingNotificationServiceWorker } from "@/lib/utils/notification-service-worker";

const deviceSchema = z.object({
  clientId: z.string().nullish(),
  push: z.object({
    state: z
      .string()
      .toLowerCase()
      .pipe(z.enum(["active", "failing", "failed"])),
    recipient: z.object({
      transportType: z.literal("web"),
      targetUrl: z.string(),
    }),
  }),
});
const ABLY_PROTOCOL_VERSION = 2;

/** Why a registration cannot deliver, in the order the check can tell. */
export type PushDeviceFault =
  | "no-browser-subscription"
  | "no-device-token"
  | "unknown-to-ably"
  | "another-reader"
  | "delivery-failed"
  | "endpoint-moved";

/**
 * What is wrong with this browser's push registration, or `null` when nothing
 * is.
 *
 * Six separate states used to answer one boolean, and the activation threw the
 * same sentence for every one of them. A reader whose registration stayed
 * unhealthy through a reset left a log that named none of the six, so the one
 * failure that repeats deterministically could not be told from the ones a
 * retry fixes. The reason is carried out of here for that log.
 *
 * Device authentication reads only this browser's registration, never admin
 * data.
 */
export async function findPushDeviceFault(
  client: Ably.Rest,
  userId: string,
): Promise<PushDeviceFault | null> {
  const registration = await getExistingNotificationServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return "no-browser-subscription";
  const device = await client.getDevice();
  if (!device.deviceIdentityToken) return "no-device-token";
  const response = await client.request<unknown>(
    "get",
    `/push/deviceRegistrations/${encodeURIComponent(device.id)}`,
    ABLY_PROTOCOL_VERSION,
    {},
    undefined,
    { authorization: `Bearer ${btoa(device.deviceIdentityToken)}` },
  );
  if (response.statusCode === 404 || response.statusCode === 401)
    return "unknown-to-ably";
  if (!response.success)
    throw new Error("Could not verify the push device registration");
  const remote = deviceSchema.parse(response.items[0]);
  // A clientId that names someone else is a device this reader must not take
  // over. A clientId that is absent is not that: the read above authenticates
  // as the device rather than with `push-admin`, and Ably answers such a read
  // without the field. Reading absence as a foreign device made the repair
  // permanent instead of safe. The reset re-registers, the next read is
  // absent again, and the activation threw for a registration Ably reports as
  // `ACTIVE` (SOK-1152). Presence is the only form of this answer that
  // carries information, so it is the only one acted on.
  if (remote.clientId && !remote.clientId.startsWith(`${userId}:`))
    return "another-reader";
  if (remote.push.state === "failed") return "delivery-failed";
  if (remote.push.recipient.targetUrl !== btoa(subscription.endpoint))
    return "endpoint-moved";
  return null;
}

/** Only a missing or invalid device credential permits skipping remote deletion. */
export function isMissingPushDevice(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error.statusCode === 404 || error.statusCode === 401)
  );
}
