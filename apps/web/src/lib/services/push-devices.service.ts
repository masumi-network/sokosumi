import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type {
  PushDevice,
  PushDeviceBrowserDetails,
} from "@/lib/clients/generated/core/types.gen";

export async function listPushDevices(): Promise<PushDevice[]> {
  const response = await notificationsBrowserClient.getPushDevices();
  return response.data;
}

export async function updatePushDeviceBrowser(
  deviceId: string,
  details: PushDeviceBrowserDetails,
): Promise<void> {
  await notificationsBrowserClient.updatePushDeviceBrowser(
    { id: deviceId },
    details,
  );
}
