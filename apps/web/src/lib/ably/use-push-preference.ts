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
  isPushSupported,
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

/**
 * Whether this browser holds a live Web Push subscription.
 *
 * Read from the browser rather than a flag of our own, so a subscription that
 * died outside the app (permission revoked, storage cleared, a half-failed
 * disable) shows as off instead of a stale on.
 *
 * This is the read half of ADR-0023's self-heal, and only the read half: it
 * re-activates nothing, and it runs in the settings card rather than on app
 * open. It also cannot see whether the device is still subscribed to the
 * notifications channel on Ably's side. SOK-876 owns both gaps.
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
   * account opt-in is unknown, which covers a read still in flight and one that
   * failed past its retries. Deliberately ignores a save in flight, so
   * the row keeps focus across a save, and deliberately ignores whether this
   * browser can push: the account axis is a Core write, and a reader whose
   * browser cannot subscribe still owns the switch that silences or wakes
   * their other devices.
   */
  canToggleAccount: boolean;
  /**
   * Whether the device row may be toggled. Adds to `canToggleAccount` that this
   * browser can subscribe, and that account consent stands. The account row is
   * the master switch: with consent withdrawn, no device receives anything, so
   * this row greys out rather than offering a change nobody could hear.
   */
  canToggleDevice: boolean;
  /** Whether a save is in flight. Each row refuses a second change until it lands. */
  isSaving: boolean;
  /**
   * Rejects on failure so the view can surface its own error toast. Resolves
   * with whether this write subscribed this browser, which is what the view
   * reports: turning consent on from a browser that cannot push, or from one
   * whose reader refuses the prompt, reaches the other devices only. Turning
   * consent off subscribes nothing either, and leaves the registrations it
   * already had (ADR-0022).
   */
  setAccountEnabled: (next: boolean) => Promise<boolean>;
  /** Rejects on failure, a refused permission included: this row is this browser. */
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
  const { data: preferences } = useQuery(getMyPreferencesQueryOptions(userId));
  const accountOptIn = preferences?.data.pushOptIn ?? null;
  const queryClient = useQueryClient();

  /**
   * Records the account-wide consent. The write returns the same DTO the read
   * does, so it seeds the cache instead of paying a second round trip.
   */
  const recordAccountOptIn = useCallback(
    async (pushOptIn: boolean) => {
      queryClient.setQueryData(
        getMyPreferencesQueryKey(userId),
        await preferencesBrowserClient.patchMyPreferences({ pushOptIn }),
      );
    },
    [queryClient, userId],
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
    async <T>(work: (sessionUserId: string) => Promise<T>): Promise<T> => {
      if (!userId) {
        throw new Error("Cannot change the push preference without a session");
      }

      setIsSaving(true);
      try {
        return await work(userId);
      } finally {
        setIsSaving(false);
      }
    },
    [userId],
  );

  /** Puts the device row back in step with the browser after a failed write. */
  const resyncSubscription = useCallback(async () => {
    // Re-read rather than assume the old value: the work may have failed
    // halfway, after the subscription already changed.
    setHasPushSubscription(await readPushSubscription());
  }, []);

  /**
   * Move this browser into `nextSubscribed`, optimistically, and roll back if
   * the work throws. The device row uses this: its own click is the thing
   * being painted, so it may move before the work lands.
   */
  const changePushSubscription = useCallback(
    <T>(nextSubscribed: boolean, work: (sessionUserId: string) => Promise<T>) =>
      runSave(async (sessionUserId) => {
        setHasPushSubscription(nextSubscribed);
        try {
          return await work(sessionUserId);
        } catch (error) {
          await resyncSubscription();
          throw error;
        }
      }),
    [resyncSubscription, runSave],
  );

  /**
   * Turns this browser into a push device, and reports whether it managed to.
   * Either row can be the first thing a reader touches, so both subscribe
   * through here, and they read a refused prompt differently: for the account
   * row it answers for this browser only, for the device row it is the whole
   * request. Anything else throws for both.
   */
  const subscribeThisBrowser = useCallback(async (sessionUserId: string) => {
    // Ask for the OS permission before anything else awaits, so the prompt
    // opens inside the click that asked for it. Ably asks a second time inside
    // `activate()` (`ably/build/push.js:194`), by which point the gesture is
    // long gone: `loadPushActivation` has fetched its chunk in between, and
    // Ably documents the prompt as valid only "in response to direct user
    // interaction". `activatePush` answers that second request from the stored
    // permission, so this one is the only prompt the reader ever sees.
    const granted = await requestBrowserNotificationPermission();
    setPermission(granted);
    if (granted !== "granted") {
      return false;
    }

    const { activatePush } = await loadPushActivation();
    await activatePush(sessionUserId);
    return true;
  }, []);

  /**
   * A missing push API and a blocked permission both stop a subscription here,
   * so `canSubscribeHere` merges them. `isBlocked` stays apart because the view
   * names the two in different words. Neither gates the account row: that row
   * is a Core write, and it still silences or wakes the other devices.
   */
  const isDenied = permission === "denied";
  const isBlocked = isSupported === true && isDenied;
  const canSubscribeHere = isSupported === true && !isDenied;

  const setAccountEnabled = useCallback(
    (next: boolean): Promise<boolean> => {
      if (!next) {
        // Consent only. Registrations stay, so the reader's other browsers do
        // not have to activate again when consent comes back (ADR-0022), and
        // this row stays reachable from a browser that never subscribed.
        return runSave(async () => {
          await recordAccountOptIn(false);
          return false;
        });
      }

      if (!canSubscribeHere) {
        // This browser cannot become a push device: no push API, or the reader
        // blocked notifications for the site. It still owns the account axis,
        // so the write wakes the reader's other devices. Subscribing first
        // here would throw and lose the consent write with it.
        return runSave(async () => {
          await recordAccountOptIn(true);
          return false;
        });
      }

      // Turning consent on also subscribes this browser, so the common case is
      // still one gesture. The device row then only ever touches this browser.
      //
      // That row moves on the answer, not ahead of it. The reader is holding
      // an OS prompt open, and the account row cannot move until its write
      // lands, so painting this one on first would sit a checked switch beside
      // its own "push is off for your account" for as long as the prompt is up.
      return runSave(async (sessionUserId) => {
        try {
          // Register the device first. If the Core write then fails, the
          // device is known to Ably but Core sends nothing, so the reader gets
          // silence rather than banners they never consented to.
          //
          // A refused prompt is not a failure here. The reader asked for push
          // on their account, and answered for this browser only, so consent
          // goes in and this browser stays out. The blocked branch above does
          // the same for a reader who refused it earlier.
          const subscribedHere = await subscribeThisBrowser(sessionUserId);
          setHasPushSubscription(subscribedHere);
          await recordAccountOptIn(true);
          return subscribedHere;
        } catch (error) {
          await resyncSubscription();
          throw error;
        }
      });
    },
    [
      canSubscribeHere,
      recordAccountOptIn,
      resyncSubscription,
      runSave,
      subscribeThisBrowser,
    ],
  );

  const setDeviceEnabled = useCallback(
    (next: boolean) =>
      changePushSubscription(next, async (sessionUserId) => {
        if (next) {
          // This row asks for one thing, so a refusal fails the whole request
          // and the view says so.
          if (!(await subscribeThisBrowser(sessionUserId))) {
            throw new Error("The browser refused the notification permission");
          }
          return;
        }

        const { deactivatePush } = await loadPushActivation();
        await deactivatePush(sessionUserId);
      }),
    [changePushSubscription, subscribeThisBrowser],
  );

  const hasSession = Boolean(userId);
  const isAccountEnabled = accountOptIn === true;

  return {
    isAccountEnabled,
    // The browser's own state, reported even while account consent is off, so
    // the reader can see which of their devices would wake up when it returns.
    isDeviceEnabled: hasPushSubscription,
    isSupported,
    isBlocked,
    canToggleAccount: hasSession && accountOptIn !== null,
    // The account row is the master switch: with consent withdrawn, no device
    // receives anything, so this row greys out rather than offering a change
    // that would alter nothing the reader can hear.
    canToggleDevice: hasSession && canSubscribeHere && isAccountEnabled,
    isSaving,
    setAccountEnabled,
    setDeviceEnabled,
  };
}
