import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { PushDevice } from "@/lib/clients/generated/core/types.gen";

export async function listPushDevices(): Promise<PushDevice[]> {
  const response = await notificationsBrowserClient.getPushDevices();
  return response.data;
}
