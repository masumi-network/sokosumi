"use client";

import { forgetPushPreference } from "./push-preference.client";
import { revokePushRenewal } from "./push-renewal.client";
import { recordPushRepairOutcome } from "./push-repair-outcome.client";
import { notePushTeardown, queuePushWork } from "./push-work-queue.client";
import {
  forgetAblyPushRegistration,
  notePushTeardownStarted,
  readPushDeviceOwner,
} from "./release-push-device.client";

/** Runs under the push lock. Core retains the revoked consent and device aliases. */
export async function stopRevokedPushDevice(userId: string): Promise<void> {
  const owner = readPushDeviceOwner();
  if (owner && owner !== userId) return;

  notePushTeardownStarted();
  forgetPushPreference();
  await reportPushOff();
  try {
    await revokePushRenewal();
    const { dropBrowserPushSubscription } = await import(
      "./push-activation.client"
    );
    await dropBrowserPushSubscription();
  } finally {
    forgetAblyPushRegistration();
    // Forgetting the SDK token clears this marker. Keep intentional-off state
    // even when browser cleanup failed or a later page loads.
    notePushTeardownStarted();
    await reportPushOff();
  }
}

/** Fence work already running before waiting for its browser lock. */
export async function handleRevokedPushDevice(userId: string): Promise<void> {
  if (readPushDeviceOwner() !== userId) return;
  notePushTeardown();
  notePushTeardownStarted();
  forgetPushPreference();
  const outcomeUpdated = reportPushOff();
  const renewalRevoked = revokePushRenewal();
  await queuePushWork(async () => {
    await outcomeUpdated;
    await renewalRevoked;
    await stopRevokedPushDevice(userId);
  });
}

async function reportPushOff(): Promise<void> {
  await recordPushRepairOutcome({ notify: true }).catch((error) =>
    console.error("Failed to report push revocation", error),
  );
}
