import { makeUserNotificationsChannelName } from "@sokosumi/utils";
import type {
  DeviceDetails,
  PaginatedResult,
  PushChannelSubscription,
} from "ably";

import { badGateway } from "@/helpers/error";
import {
  type PushDevice,
  pushDeviceBrowserDetailsSchema,
  pushDeviceSchema,
} from "@/schemas/push-device.schema";
import { getPushAdminRestClient } from "./client";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";

// Bounds concurrent registry reads. Follow every page, including empty pages.
const SUBSCRIPTION_PAGE_SIZE = 20;

export async function listPushDevices(userId: string): Promise<PushDevice[]> {
  const client = getPushAdminRestClient();
  const channel = makeUserNotificationsChannelName(
    userId,
    getNotificationChannelEnvironment(),
  );
  const devices = new Map<string, PushDevice>();
  try {
    let page: PaginatedResult<PushChannelSubscription> | null =
      await client.push.admin.channelSubscriptions.list({
        channel,
        limit: SUBSCRIPTION_PAGE_SIZE,
      });
    while (page) {
      const ids = [
        ...new Set(
          page.items
            .filter((item) => item.channel === channel)
            .flatMap((item) => (item.deviceId ? [item.deviceId] : [])),
        ),
      ];
      const registrations = await Promise.all(
        ids
          .filter((id) => !devices.has(id))
          .map(async (id): Promise<DeviceDetails | null> => {
            try {
              const device =
                await client.push.admin.deviceRegistrations.get(id);
              return device.id === id ? device : null;
            } catch (error) {
              // A device may be removed between the subscription and registry reads.
              if (
                typeof error === "object" &&
                error !== null &&
                "statusCode" in error &&
                error.statusCode === 404
              )
                return null;
              throw error;
            }
          }),
      );
      for (const device of registrations) {
        // A shared browser can retain an old channel subscription after an account switch.
        if (!device?.clientId?.startsWith(`${userId}:`)) continue;
        devices.set(device.id, {
          id: device.id,
          browserDetails: pushDeviceBrowserDetailsSchema
            .optional()
            .catch(undefined)
            .parse(
              device.platform === "browser"
                ? device.metadata?.sokosumiBrowser
                : undefined,
            ),
          registeredAt: pushDeviceSchema.shape.registeredAt
            .catch(undefined)
            .parse(device.metadata?.sokosumiRegisteredAt),
          platform: pushDeviceSchema.shape.platform
            .catch("unknown")
            .parse(device.platform),
          formFactor: pushDeviceSchema.shape.formFactor
            .catch("other")
            .parse(device.formFactor),
          state: pushDeviceSchema.shape.state
            .catch("unknown")
            .parse(device.push?.state?.toLowerCase()),
        });
      }
      page = await page.next();
    }
  } catch {
    // Provider responses may contain device credentials or push endpoints.
    throw badGateway("Unable to retrieve push devices");
  }
  return [...devices.values()].sort((a, b) => a.id.localeCompare(b.id));
}
