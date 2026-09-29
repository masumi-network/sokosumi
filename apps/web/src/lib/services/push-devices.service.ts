import type {
  PushDevice,
  PushDeviceActivation,
  PushDeviceActivationRequest,
  PushDeviceBrowserUpdate,
  PushDeviceSubscriptionRequest,
} from "@sokosumi/core-client";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";

export async function listPushDevices(): Promise<PushDevice[]> {
  const response = await notificationsBrowserClient.getPushDevices();
  return response.data;
}

export async function updatePushDeviceBrowser(
  deviceId: string,
  details: PushDeviceBrowserUpdate,
): Promise<void> {
  await notificationsBrowserClient.updatePushDeviceBrowser(
    { id: deviceId },
    details,
  );
}

export async function beginPushActivation(
  input: PushDeviceActivationRequest,
): Promise<PushDeviceActivation> {
  const response = await notificationsBrowserClient.beginPushActivation(input);
  return response.data;
}

export async function subscribePushDevice(
  deviceId: string,
  input: PushDeviceSubscriptionRequest,
): Promise<boolean> {
  const response = await notificationsBrowserClient.subscribePushDevice(
    { id: deviceId },
    input,
  );
  return response.data.subscribed;
}

export async function revokePushDevice(deviceId: string): Promise<void> {
  await notificationsBrowserClient.revokePushDevice({ id: deviceId });
}
