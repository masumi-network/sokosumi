"use client";

import type Ably from "ably";
import type { PushDeviceBrowserDetails } from "@/lib/clients/generated/core/types.gen";
import { updatePushDeviceBrowser } from "@/lib/services/push-devices.service";
import { getOSFromUserAgent } from "@/lib/utils/user-agent";

// Browser names are hints from the user agent, not verified device identities.
export function getPushDeviceBrowserDetails(): PushDeviceBrowserDetails | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  let browser: PushDeviceBrowserDetails["browser"];
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera|OPiOS\//i.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//i.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Version\/.*Safari\//i.test(ua)) browser = "Safari";
  else return null;

  const { os } = getOSFromUserAgent();
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
