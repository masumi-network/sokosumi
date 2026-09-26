"use client";

import { getBrowserNotificationPermission } from "@/lib/utils/browser-notification";
import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";

import { getPushTeardownVersion } from "./push-work-queue.client";
import {
  hasAblyPushRegistration,
  hasUnfinishedPushTeardown,
  hasUnresolvedPushRepair,
  setUnresolvedPushRepair,
} from "./release-push-device.client";

/**
 * What the app-open repair left this browser in.
 *
 * `quiet` is the state SOK-929 names: this browser was set up for push, it
 * holds no subscription, and `healPushSubscription` could not bring one back.
 * Nothing else in the app says so, so the reader hears nothing and has no
 * reason to visit the page that would tell them.
 *
 * `healthy` covers every other answer in one word on purpose. A browser that
 * was repaired, one that never turned push on, one whose reader turned it off,
 * one without the push API, and one signing out are all browsers with nothing
 * to tell the reader.
 *
 * `pending` is before the repair has answered. It is not `healthy`: reporting
 * a browser as fine before anything read it would flash the notice off for
 * readers whose browser is quiet, and reporting it quiet would flash the
 * notice on for every reader whose repair works.
 */
export type PushRepairOutcome = "pending" | "quiet" | "healthy";

let outcome: PushRepairOutcome = "pending";
const listeners = new Set<() => void>();

export function getPushRepairOutcome(): PushRepairOutcome {
  return outcome;
}

/**
 * Always `pending` on the server. The answer is read from the browser, so
 * there is none to render with, and a view that guessed one would hydrate
 * against a different answer.
 */
export function getServerPushRepairOutcome(): PushRepairOutcome {
  return "pending";
}

export function subscribePushRepairOutcome(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

interface RecordPushRepairOutcomeOptions {
  /**
   * Whether Ably held a registration for this browser *before* the repair
   * ran, which the caller has to have read for itself.
   *
   * An activation clears Ably's own state halfway through its round
   * (`push-activation.client.ts`, around `client.push.deactivate()`), so a
   * repair that fails after that point takes the registration with it. Read
   * again afterwards, such a browser looks like one that never turned push
   * on, and the reader whose push just broke is the one reader this would
   * then say nothing to.
   */
  hadRegistration?: boolean;
  deliveryHealthy?: boolean;
  /** Captured before activation, so a later sign-out invalidates its result. */
  teardownVersion?: string;
}

/**
 * Reads this browser and records what it found.
 *
 * Called when the app-open repair settles, whichever way it went, and again
 * after a reader asks for the subscription back. Every read is local, so this
 * costs no request.
 */
export async function recordPushRepairOutcome(
  options?: RecordPushRepairOutcomeOptions,
): Promise<void> {
  const teardownVersion = options?.teardownVersion ?? getPushTeardownVersion();
  if (teardownVersion !== getPushTeardownVersion()) {
    return;
  }
  const next = await readPushRepairOutcome(
    options?.hadRegistration === true,
    options?.deliveryHealthy,
  );
  if (teardownVersion !== getPushTeardownVersion()) {
    return;
  }
  setUnresolvedPushRepair(next === "quiet");
  if (next === outcome) {
    return;
  }

  outcome = next;
  for (const listener of listeners) {
    listener();
  }
}

async function readPushRepairOutcome(
  hadRegistration: boolean,
  deliveryHealthy?: boolean,
): Promise<"quiet" | "healthy"> {
  if (
    !isPushSupported() ||
    getBrowserNotificationPermission() !== "granted" ||
    // The same registration `healPushSubscription` repairs from: it is what
    // separates a browser that went quiet from one that never turned push on,
    // and a reader who never asked for push is not owed a notice about it.
    // The caller's own read of it comes first, because a repair can destroy
    // the registration on its way past.
    !(
      hadRegistration ||
      hasAblyPushRegistration() ||
      hasUnresolvedPushRepair()
    ) ||
    // A sign-out in flight takes the subscription with it. That browser is
    // quiet because the reader is leaving, which is not a fault to report.
    hasUnfinishedPushTeardown()
  ) {
    return "healthy";
  }

  if (
    deliveryHealthy === false ||
    (deliveryHealthy === undefined && hasUnresolvedPushRepair())
  )
    return "quiet";
  return (await hasWebPushSubscription()) ? "healthy" : "quiet";
}
