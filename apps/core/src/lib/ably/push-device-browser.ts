import { makeUserNotificationsChannelName } from "@sokosumi/utils";
import { z } from "zod";
import { badGateway, notFound } from "@/helpers/error";
import type { PushDeviceBrowserDetails } from "@/schemas/push-device.schema";
import { getPushAdminRestClient } from "./client";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";

const ABLY_PROTOCOL_VERSION = 2;

export async function updatePushDeviceBrowser(
  userId: string,
  deviceId: string,
  browserDetails: PushDeviceBrowserDetails,
): Promise<void> {
  const client = getPushAdminRestClient();
  const channel = makeUserNotificationsChannelName(
    userId,
    getNotificationChannelEnvironment(),
  );
  const device = await client.push.admin.deviceRegistrations
    .get(deviceId)
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404
      )
        throw notFound("Push device not found");
      throw badGateway("Unable to update push device");
    });
  if (
    device.id !== deviceId ||
    device.platform !== "browser" ||
    !device.clientId?.startsWith(`${userId}:`)
  )
    throw notFound("Push device not found");

  let subscribed = false;
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
      ) {
        subscribed = true;
        break;
      }
      const next = await page.next();
      if (!next) break;
      page = next;
    }
  } catch {
    throw badGateway("Unable to update push device");
  }
  if (!subscribed) throw notFound("Push device not found");

  const metadata = z
    .record(z.string(), z.unknown())
    .catch({})
    .parse(device.metadata);
  // PATCH only metadata: never recreate a deleted device or change its push recipient.
  const response = await client
    .request(
      "patch",
      `/push/deviceRegistrations/${encodeURIComponent(deviceId)}`,
      ABLY_PROTOCOL_VERSION,
      {},
      { metadata: { ...metadata, sokosumiBrowser: browserDetails } },
    )
    .catch(() => {
      throw badGateway("Unable to update push device");
    });
  if (response.statusCode === 404) throw notFound("Push device not found");
  if (!response.success) throw badGateway("Unable to update push device");
}
