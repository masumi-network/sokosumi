"use client";

import type { PushDeviceBrowserDetails } from "@sokosumi/core-client";
import type Ably from "ably";
import { updatePushDeviceBrowser } from "@/lib/services/push-devices.service";
import {
  getBrowserFromUserAgent,
  getOSFromUserAgent,
} from "@/lib/utils/user-agent";

// Browser names are hints from the user agent, not verified device identities.
export function getPushDeviceBrowserDetails(): PushDeviceBrowserDetails | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const browser = getBrowserFromUserAgent(ua);
  if (!browser) return null;

  const { os } = getOSFromUserAgent(ua);
  if (/CrOS/i.test(ua)) return { browser, operatingSystem: "ChromeOS" };
  if (os === "Unknown") return null;
  if (os === "MacOS") {
    return {
      browser,
      operatingSystem: navigator.maxTouchPoints > 1 ? "iOS" : "macOS",
    };
  }
  return { browser, operatingSystem: os };
}

export async function recordPushDeviceBrowser(
  client: Pick<Ably.Rest, "getDevice">,
  userId: string,
  registeredAt?: Date,
): Promise<void> {
  const details = getPushDeviceBrowserDetails();
  if (!details && !registeredAt) return;
  const device = await client.getDevice();
  if (
    !("clientId" in device) ||
    typeof device.clientId !== "string" ||
    !device.clientId.startsWith(`${userId}:`)
  )
    return;
  await updatePushDeviceBrowser(device.id, {
    ...details,
    ...(registeredAt ? { registeredAt } : {}),
  });
}
