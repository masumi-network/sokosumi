"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";
import {
  type BrowserNotificationPermission,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  subscribeBrowserNotificationPermission,
} from "@/lib/utils/browser-notification";
import {
  hasWebPushSubscription,
  isServiceWorkerSupported,
} from "@/lib/utils/notification-service-worker";
import {
  getMyPreferencesQueryKey,
  getMyPreferencesQueryOptions,
} from "@/queries/preferences";

export type PushDisableScope = "thisDevice" | "allDevices";

/**
 * Loads the activation module on the click that needs it. That module pulls in
 * the Ably SDK, and the account page must not carry the SDK for every reader
 * who only came to change an email preference. The repo keeps the SDK behind a
 * lazy boundary everywhere else too (`contexts/lazy-ably-provider.tsx`).
 */
function loadPushActivation() {
  return import("./push-activation.client");
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "PushManager" in window &&
    isServiceWorkerSupported() &&
    getBrowserNotificationPermission() !== "unsupported"
  );
}

/**
 * Whether this browser holds a live Web Push subscription.
 *
 * Read from the browser rather than a flag of our own, so a subscription that
 * died outside the app (permission revoked, storage cleared, a half-failed
 * disable) shows as off instead of a stale on.
 *
 * This is the read half of ADR-0018's self-heal, and only the read half: it
 * re-activates nothing, and it runs in the settings card rather than on app
 * open. It also cannot see whether the device is still subscribed to the
 * notifications channel on Ably's side. SOK-876 owns both gaps.
 *
 * One consequence until then: a device that lost its subscription reads as off
 * and so offers no "all devices" disable, leaving account-wide consent standing
 * until the reader turns push on again here. Self-heal closes that with the
 * rest.
 */
async function readPushSubscription(): Promise<boolean> {
  if (!isPushSupported() || getBrowserNotificationPermission() !== "granted") {
    return false;
  }

  return hasWebPushSubscription();
}

interface PushPreference {
  /** True only when this browser is subscribed and the account is opted in. */
  enabled: boolean;
  isSupported: boolean;
  /**
   * Whether the browser blocks notifications for this site. Enabling can only
   * fail while it does, so the view says so rather than leaving the reader with
   * the generic failure toast.
   */
  isBlocked: boolean;
  /**
   * Whether the switch may be enabled. False while the session or the account
   * opt-in is still loading, or the browser cannot push. Deliberately ignores
   * a save in flight: disabling the switch mid-save would drop focus when the
   * disable dialog closes.
   */
  canToggle: boolean;
  /** Whether a change may start now. `canToggle` minus a save in flight. */
  canSubmit: boolean;
  /** Rejects on failure so the view can surface its own error toast. */
  enable: () => Promise<void>;
  disable: (scope: PushDisableScope) => Promise<void>;
}

export function usePushPreference(userId: string | undefined): PushPreference {
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [permission, setPermission] =
    useState<BrowserNotificationPermission | null>(null);

  /**
   * The account-wide consent. Undefined until it arrives and while it fails,
   * which leaves the switch unusable rather than guessing the reader's
   * consent. The cost is a dead switch with no message on a read failure that
   * outlasts the query's retries.
   */
  const { data: preferences } = useQuery(getMyPreferencesQueryOptions());
  const accountOptIn = preferences?.data.pushOptIn ?? null;
  const queryClient = useQueryClient();

  /**
   * Records the account-wide consent. The write returns the same DTO the read
   * does, so it seeds the cache instead of paying a second round trip.
   */
  const recordAccountOptIn = useCallback(
    async (pushOptIn: boolean) => {
      queryClient.setQueryData(
        getMyPreferencesQueryKey(),
        await preferencesBrowserClient.patchMyPreferences({ pushOptIn }),
      );
    },
    [queryClient],
  );

  // Browser-only reads, so they cannot run during render.
  useMountEffect(() => {
    // The subscription read outlives a reader who leaves the account page
    // mid-flight, so it checks before it lands. Same shape as
    // `lazy-ably-provider.tsx`.
    let cancelled = false;

    setIsSupported(isPushSupported());
    void readPushSubscription().then((subscribed) => {
      if (!cancelled) {
        setHasPushSubscription(subscribed);
      }
    });
    setPermission(getBrowserNotificationPermission());

    // Re-read the permission when the reader changes it in browser settings,
    // so the blocked message clears without a reload.
    const unsubscribe = subscribeBrowserNotificationPermission(setPermission);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  });

  /**
   * Move this browser into `nextSubscribed`, optimistically, and roll back if
   * the work throws. Hands the session user id to the callback so neither
   * branch needs a cast.
   */
  const changePushSubscription = useCallback(
    async (
      nextSubscribed: boolean,
      work: (sessionUserId: string) => Promise<void>,
    ) => {
      if (!userId) {
        throw new Error("Cannot change the push preference without a session");
      }

      setHasPushSubscription(nextSubscribed);
      setIsSaving(true);
      try {
        await work(userId);
      } catch (error) {
        // Re-read rather than assume the old value: the work may have failed
        // halfway, after the subscription already changed.
        setHasPushSubscription(await readPushSubscription());
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [userId],
  );

  const enable = useCallback(
    () =>
      changePushSubscription(true, async (sessionUserId) => {
        // Ask for the OS permission before anything else awaits, so the prompt
        // opens inside the click that asked for it. Ably requests it too
        // (`ably/build/push.js:194`), but only after `loadPushActivation`
        // fetches its chunk, and Ably documents the prompt as valid only "in
        // response to direct user interaction". `activate()` then finds the
        // permission already granted and opens no second prompt.
        const granted = await requestBrowserNotificationPermission();
        setPermission(granted);
        if (granted !== "granted") {
          throw new Error("The browser refused the notification permission");
        }

        // Register the device first. If the Core write then fails, the device
        // is known to Ably but Core sends nothing, so the reader gets silence
        // rather than banners they never consented to.
        const { activatePush } = await loadPushActivation();
        await activatePush(sessionUserId);
        await recordAccountOptIn(true);
      }),
    [changePushSubscription, recordAccountOptIn],
  );

  const disable = useCallback(
    (scope: PushDisableScope) =>
      changePushSubscription(false, async (sessionUserId) => {
        const { deactivatePush } = await loadPushActivation();
        if (scope === "allDevices") {
          // Withdraw consent first: if the deregistration then fails, Core has
          // already stopped sending to every browser.
          await recordAccountOptIn(false);
        }
        await deactivatePush(sessionUserId);
      }),
    [changePushSubscription, recordAccountOptIn],
  );

  const canToggle = isSupported && Boolean(userId) && accountOptIn !== null;

  return {
    enabled: hasPushSubscription && accountOptIn === true,
    isSupported,
    isBlocked: isSupported && permission === "denied",
    canToggle,
    canSubmit: canToggle && !isSaving,
    enable,
    disable,
  };
}
