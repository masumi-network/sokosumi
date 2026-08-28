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
 * This is the read half of ADR-0020's self-heal, and only the read half: it
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

/**
 * Push consent has two independent axes, and one switch could not say which
 * one the reader meant. The account axis is `pushOptIn`, stored on the user and
 * read by Core's publish gate: off silences every browser at once. The device
 * axis is this browser's own Web Push subscription: off silences only here and
 * leaves the reader's other devices alone.
 *
 * Splitting them also reaches a state one switch could not. A browser holding
 * no subscription used to read as off, so the disable dialog never opened and
 * account-wide consent could not be withdrawn from it at all.
 */
export interface PushPreference {
  /** Account-wide consent. Off means no browser receives a push. */
  isAccountEnabled: boolean;
  /** Whether this browser holds a live push subscription. */
  isDeviceEnabled: boolean;
  /**
   * Whether this browser can push at all. Null until the mount read lands: the
   * answer needs `window`, so it cannot be read during render, and reporting
   * `false` in the meantime told every reader on every browser that theirs does
   * not support push.
   */
  isSupported: boolean | null;
  /**
   * Whether the browser blocks notifications for this site. Subscribing can
   * only fail while it does, so the view says so rather than leaving the reader
   * with the generic failure toast.
   */
  isBlocked: boolean;
  /**
   * Whether the account row may be toggled. False while the session or the
   * account opt-in is still loading. Deliberately ignores a save in flight, so
   * the row keeps focus across a save, and deliberately ignores whether this
   * browser can push: the account axis is a Core write, and a reader whose
   * browser cannot subscribe still owns the switch that silences or wakes
   * their other devices.
   */
  canToggleAccount: boolean;
  /**
   * Whether the device row may be toggled. Adds to `canToggleAccount` that this
   * browser can subscribe, and that there is something here to change: with the
   * account gate closed and no subscription held, turning it on would spend a
   * permission prompt on a browser the gate then silences.
   */
  canToggleDevice: boolean;
  /** Whether a save is in flight. Each row refuses a second change until it lands. */
  isSaving: boolean;
  /** Rejects on failure so the view can surface its own error toast. */
  setAccountEnabled: (next: boolean) => Promise<void>;
  setDeviceEnabled: (next: boolean) => Promise<void>;
}

export function usePushPreference(userId: string | undefined): PushPreference {
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
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
    const refreshSubscription = () => {
      void readPushSubscription().then((subscribed) => {
        if (!cancelled) {
          setHasPushSubscription(subscribed);
        }
      });
    };

    setIsSupported(isPushSupported());
    refreshSubscription();
    setPermission(getBrowserNotificationPermission());

    // Re-read the permission when the reader changes it in browser settings,
    // so the blocked message clears without a reload. The subscription is read
    // again with it: revoking the permission takes the subscription with it,
    // and a device row still reading as on would sit there checked beside its
    // own "not available in this browser".
    const unsubscribe = subscribeBrowserNotificationPermission((next) => {
      setPermission(next);
      refreshSubscription();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  });

  /**
   * Runs one save against the session user and holds the saving flag for its
   * duration. Hands the session user id to the callback so callers need no
   * cast. Withdrawing account consent uses this directly: it touches no
   * browser subscription, so there is nothing to roll back.
   */
  const runSave = useCallback(
    async (work: (sessionUserId: string) => Promise<void>) => {
      if (!userId) {
        throw new Error("Cannot change the push preference without a session");
      }

      setIsSaving(true);
      try {
        await work(userId);
      } finally {
        setIsSaving(false);
      }
    },
    [userId],
  );

  /**
   * Move this browser into `nextSubscribed`, optimistically, and roll back if
   * the work throws.
   */
  const changePushSubscription = useCallback(
    (nextSubscribed: boolean, work: (sessionUserId: string) => Promise<void>) =>
      runSave(async (sessionUserId) => {
        setHasPushSubscription(nextSubscribed);
        try {
          await work(sessionUserId);
        } catch (error) {
          // Re-read rather than assume the old value: the work may have failed
          // halfway, after the subscription already changed.
          setHasPushSubscription(await readPushSubscription());
          throw error;
        }
      }),
    [runSave],
  );

  /**
   * Turns this browser into a push device. Either row can be the first thing a
   * reader touches, so both subscribe through here.
   */
  const subscribeThisBrowser = useCallback(async (sessionUserId: string) => {
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

    const { activatePush } = await loadPushActivation();
    await activatePush(sessionUserId);
  }, []);

  /**
   * Whether this browser could become a push device at all. A missing push API
   * and a blocked permission fail the same way, so they answer as one: both
   * rows read this, and neither may promise a subscription it cannot make.
   */
  const isBlocked = isSupported === true && permission === "denied";
  const canSubscribeHere = isSupported === true && !isBlocked;

  const setAccountEnabled = useCallback(
    (next: boolean) => {
      if (!next) {
        // Consent only. Registrations stay, so the reader's other browsers do
        // not have to activate again when consent comes back (ADR-0019), and
        // this row stays reachable from a browser that never subscribed.
        return runSave(() => recordAccountOptIn(false));
      }

      if (!canSubscribeHere) {
        // This browser cannot become a push device: no push API, or the reader
        // blocked notifications for the site. It still owns the account axis,
        // so the write wakes the reader's other devices. Subscribing first
        // here would throw and lose the consent write with it.
        return runSave(() => recordAccountOptIn(true));
      }

      // Turning consent on also subscribes this browser, so the common case is
      // still one gesture. The device row then only ever touches this browser.
      return changePushSubscription(true, async (sessionUserId) => {
        // Register the device first. If the Core write then fails, the device
        // is known to Ably but Core sends nothing, so the reader gets silence
        // rather than banners they never consented to.
        await subscribeThisBrowser(sessionUserId);
        await recordAccountOptIn(true);
      });
    },
    [
      canSubscribeHere,
      changePushSubscription,
      recordAccountOptIn,
      runSave,
      subscribeThisBrowser,
    ],
  );

  const setDeviceEnabled = useCallback(
    (next: boolean) =>
      changePushSubscription(next, async (sessionUserId) => {
        if (next) {
          await subscribeThisBrowser(sessionUserId);
          return;
        }

        const { deactivatePush } = await loadPushActivation();
        await deactivatePush(sessionUserId);
      }),
    [changePushSubscription, subscribeThisBrowser],
  );

  const canToggleAccount = Boolean(userId) && accountOptIn !== null;

  return {
    isAccountEnabled: accountOptIn === true,
    // The browser's own state, reported even while account consent is off, so
    // the reader can see which of their devices would wake up when it returns.
    isDeviceEnabled: hasPushSubscription,
    isSupported,
    isBlocked,
    canToggleAccount,
    // Unlocked while the account is off if this browser holds a subscription,
    // so the reader can still drop this device (story 8). With nothing to drop
    // and the account gate closed, turning it on would spend a permission
    // prompt on a browser the gate then silences.
    canToggleDevice:
      canToggleAccount &&
      canSubscribeHere &&
      (accountOptIn === true || hasPushSubscription),
    isSaving,
    setAccountEnabled,
    setDeviceEnabled,
  };
}
