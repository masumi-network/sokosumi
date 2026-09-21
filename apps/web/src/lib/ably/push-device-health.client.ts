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

/** Device authentication reads only this browser's registration, never admin data. */
export async function pushDeviceNeedsReset(
  client: Ably.Rest,
  userId: string,
): Promise<boolean> {
  const registration = await getExistingNotificationServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return true;
  const device = await client.getDevice();
  if (!device.deviceIdentityToken) return true;
  const response = await client.request<unknown>(
    "get",
    `/push/deviceRegistrations/${encodeURIComponent(device.id)}`,
    ABLY_PROTOCOL_VERSION,
    {},
    undefined,
    { authorization: `Bearer ${btoa(device.deviceIdentityToken)}` },
  );
  if (response.statusCode === 404 || response.statusCode === 401) return true;
  if (!response.success)
    throw new Error("Could not verify the push device registration");
  const remote = deviceSchema.parse(response.items[0]);
  return (
    !remote.clientId?.startsWith(`${userId}:`) ||
    remote.push.state === "failed" ||
    remote.push.recipient.targetUrl !== btoa(subscription.endpoint)
  );
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
