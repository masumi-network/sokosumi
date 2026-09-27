import { z } from "zod";
import { badGateway, notFound } from "@/helpers/error";
import {
  type PushDeviceBrowserUpdate,
  pushDeviceSchema,
} from "@/schemas/push-device.schema";
import { getPushAdminRestClient } from "./client";
import {
  getOwnedPushDevice,
  getPushDeviceChannel,
  isPushDeviceSubscribed,
} from "./push-device-ownership";

const ABLY_PROTOCOL_VERSION = 2;

export async function updatePushDeviceBrowser(
  userId: string,
  deviceId: string,
  update: PushDeviceBrowserUpdate,
): Promise<void> {
  const client = getPushAdminRestClient();
  const channel = getPushDeviceChannel(userId);
  const device = await getOwnedPushDevice(client, userId, deviceId);
  if (
    !device ||
    device.platform !== "browser" ||
    !(await isPushDeviceSubscribed(client, channel, deviceId))
  ) {
    throw notFound("Push device not found");
  }

  const metadata = z
    .record(z.string(), z.unknown())
    .catch({})
    .parse(device.metadata);
  const registeredAt =
    pushDeviceSchema.shape.registeredAt
      .catch(undefined)
      .parse(metadata.sokosumiRegisteredAt) ?? update.registeredAt;
  const browserDetails =
    update.browser && update.operatingSystem
      ? { browser: update.browser, operatingSystem: update.operatingSystem }
      : undefined;
  // PATCH only metadata: never recreate a deleted device or change its push recipient.
  const response = await client
    .request(
      "patch",
      `/push/deviceRegistrations/${encodeURIComponent(deviceId)}`,
      ABLY_PROTOCOL_VERSION,
      {},
      {
        metadata: {
          ...metadata,
          ...(browserDetails ? { sokosumiBrowser: browserDetails } : {}),
          ...(registeredAt ? { sokosumiRegisteredAt: registeredAt } : {}),
        },
      },
    )
    .catch(() => {
      throw badGateway("Unable to update push device");
    });
  if (response.statusCode === 404) throw notFound("Push device not found");
  if (!response.success) throw badGateway("Unable to update push device");
}
