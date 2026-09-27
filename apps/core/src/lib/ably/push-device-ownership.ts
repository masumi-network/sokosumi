import { makeUserNotificationsChannelName } from "@sokosumi/utils";
import type { DeviceDetails, Rest } from "ably";
import { badGateway } from "@/helpers/error";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";

export function getPushDeviceChannel(userId: string): string {
  return makeUserNotificationsChannelName(
    userId,
    getNotificationChannelEnvironment(),
  );
}

export async function getOwnedPushDevice(
  client: Rest,
  userId: string,
  deviceId: string,
): Promise<DeviceDetails | null> {
  try {
    const device = await client.push.admin.deviceRegistrations.get(deviceId);
    return device.id === deviceId && device.clientId?.startsWith(`${userId}:`)
      ? device
      : null;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404
    )
      return null;
    throw badGateway("Unable to manage push device");
  }
}

export async function isPushDeviceSubscribed(
  client: Rest,
  channel: string,
  deviceId: string,
): Promise<boolean> {
  try {
    let page = await client.push.admin.channelSubscriptions.list({
      channel,
      deviceId,
      limit: 1,
    });
    while (page) {
      if (
        page.items.some(
          (item) => item.channel === channel && item.deviceId === deviceId,
        )
      )
        return true;
      const next = await page.next();
      if (!next) break;
      page = next;
    }
    return false;
  } catch {
    throw badGateway("Unable to manage push device");
  }
}
