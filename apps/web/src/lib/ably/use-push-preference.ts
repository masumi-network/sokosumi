"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

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
 * Push consent has two independent axes, and neither implies the other. The
 * account axis is `pushOptIn`, stored on the user and read by Core's publish
 * gate: off silences every browser at once. The device axis is this browser's
 * own Web Push subscription: gone, this browser stays quiet while the reader's
 * other devices carry on.
 *
 * The account page carries no switch for either any more. Its Push cells ask
 * for whichever axis is missing, so both stay separately readable here: a
 * browser that lost its subscription while consent stands is a state the cells
 * have to tell apart, and a single answer could not.
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
   * Whether account consent may be written. False while the session or the
   * account opt-in is unknown, which covers a read still in flight and one that
   * failed past its retries. Deliberately ignores a save in flight, and
   * deliberately ignores whether this browser can push: the account axis is a
   * Core write, and a reader whose browser cannot subscribe still owns what
   * silences or wakes their other devices.
   */
  canToggleAccount: boolean;
  /**
   * Whether this browser may subscribe. Adds to `canToggleAccount` that this
   * browser can push at all, and that account consent stands. Consent is the
   * master switch: with it withdrawn, no device receives anything, so
   * subscribing here would buy the reader nothing.
   */
  canToggleDevice: boolean;
  /**
   * Whether a save is in flight. The caller refuses a second change until it
   * lands: two saves read the same answer and race over one subscription.
   */
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
      const written = await preferencesBrowserClient.patchMyPreferences({
        pushOptIn,
      });
      // A read that started before this write can answer after it, carrying
      // the consent as it stood before. The page keeps that query open, it
      // goes stale after a minute, and it refetches when the tab is hidden
      // and shown again, or when the connection returns. Enabling push waits
      // on an OS prompt the reader paces, which leaves room for either.
      // Retired here rather than left to paint the switch back off beside a
      // toast saying push is on.
      await queryClient.cancelQueries({
        queryKey: getMyPreferencesQueryKey(userId),
      });
      queryClient.setQueryData(getMyPreferencesQueryKey(userId), written);
    },
    [queryClient, userId],
  );

  /**
   * Which read of the browser may still write what this browser reports.
   *
   * Reads land out of order. Two overlap whenever the reader regains focus
   * while an earlier read is still open, and the older one carries the browser
   * as it stood before the newer one looked. So every write takes a ticket and
   * only the newest lands, in either resolution order.
   */
  const latestSubscriptionRead = useRef(0);

  /**
   * Whether a save owns the row, so an unasked-for read cannot paint over it.
   *
   * A ref, not `isSaving`, because the reads that consult it are set up once
   * on mount and would close over the first value of any state.
   */
  const saveOwnsSubscriptionRow = useRef(false);

  /** Reads the browser and paints the row, unless a newer write started. */
  const applySubscriptionRead = useCallback(async () => {
    const readId = ++latestSubscriptionRead.current;
    const subscribed = await readPushSubscription();
    if (readId === latestSubscriptionRead.current) {
      setHasPushSubscription(subscribed);
    }
  }, []);

  /**
   * A read the reader did not ask for, so it yields to one that is.
   *
   * Granting the OS permission fires a permission change, and its refresh
   * reads the browser in the middle of the activation that asked for the
   * permission. It finds no subscription yet. Letting it write would turn the
   * switch the reader just clicked back off for the length of the activation,
   * beside a toast saying push is on. The save ends on its own read, so
   * nothing is lost by skipping this one.
   */
  const refreshSubscriptionRow = useCallback(() => {
    if (saveOwnsSubscriptionRow.current) {
      return;
    }

    void applySubscriptionRead();
  }, [applySubscriptionRead]);

  /** Paints a value the caller already knows, and retires any read in flight. */
  const setSubscriptionKnown = useCallback((subscribed: boolean) => {
    latestSubscriptionRead.current += 1;
    setHasPushSubscription(subscribed);
  }, []);

  // Browser-only reads, so they cannot run during render.
  useMountEffect(() => {
    setIsSupported(isPushSupported());
    refreshSubscriptionRow();
    setPermission(getBrowserNotificationPermission());

    // Re-read the permission when the reader changes it in browser settings,
    // so the blocked message clears without a reload. The subscription is read
    // again with it: revoking the permission takes the subscription with it,
    // and a cell still drawn on would sit there beside its own "not
    // available in this browser".
    const unsubscribe = subscribeBrowserNotificationPermission((next) => {
      setPermission(next);
      refreshSubscriptionRow();
    });
    return () => {
      // Retires the reads this effect issued, so one does not land on a reader
      // who left the account page mid-flight. Same intent as the cancelled
      // flag in `lazy-ably-provider.tsx`.
      latestSubscriptionRead.current += 1;
      unsubscribe();
    };
  });

  /**
   * Runs one save against the session user, and leaves the reported device
   * state reading the browser however that save went. Hands the session user
   * id to the callback so callers need no cast.
   *
   * The subscription read is held for the save and run once at the end, and
   * both belong here together. A save that held it without reading would drop
   * the refreshes it suppressed rather than defer them: the reader could
   * revoke the permission mid-save and leave a cell drawn on beside a browser
   * that can no longer push. Withdrawing account consent touches no
   * subscription and still pays the read, which costs one local lookup.
   *
   * The read runs after the hold is released, so a permission change landing
   * during it takes a newer ticket and still wins.
   */
  const runSave = useCallback(
    async <T>(work: (sessionUserId: string) => Promise<T>): Promise<T> => {
      if (!userId) {
        throw new Error("Cannot change the push preference without a session");
      }

      setIsSaving(true);
      saveOwnsSubscriptionRow.current = true;
      try {
        return await work(userId);
      } finally {
        saveOwnsSubscriptionRow.current = false;
        setIsSaving(false);
        await applySubscriptionRead();
      }
    },
    [applySubscriptionRead, userId],
  );

  /**
   * Move this browser into `nextSubscribed` before the work lands. The device
   * row uses this: its own click is the thing being painted, so it may lead
   * the work. The read that ends every save is what corrects it when the
   * browser did not end up where the click asked.
   */
  const changePushSubscription = useCallback(
    <T>(nextSubscribed: boolean, work: (sessionUserId: string) => Promise<T>) =>
      runSave(async (sessionUserId) => {
        setSubscriptionKnown(nextSubscribed);
        return work(sessionUserId);
      }),
    [runSave, setSubscriptionKnown],
  );

  /**
   * Turns this browser into a push device, and reports whether it managed to.
   * Either axis can be the first thing a reader asks for, so both subscribe
   * through here, and they read a refused prompt differently: for consent it
   * answers for this browser only, for the subscription it is the whole
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
   * names the two in different words. Neither gates account consent: that is a
   * Core write, and it still silences or wakes the other devices.
   */
  const isDenied = permission === "denied";
  const isBlocked = isSupported === true && isDenied;
  const canSubscribeHere = isSupported === true && !isDenied;

  const setAccountEnabled = useCallback(
    (next: boolean): Promise<boolean> => {
      if (!next) {
        // Consent only. Registrations stay, so the reader's other browsers do
        // not have to activate again when consent comes back (ADR-0022). No
        // control writes this today: the account page silences push by
        // clearing its cells, which Core's publish gate reads per kind.
        return runSave(async () => {
          await recordAccountOptIn(false);
          return false;
        });
      }

      if (!canSubscribeHere) {
        // This browser cannot become a push device: no push API, or the reader
        // blocked notifications for the site. It still writes the account
        // axis, so the write wakes the reader's other devices. Subscribing
        // here would throw and lose the consent write with it.
        return runSave(async () => {
          await recordAccountOptIn(true);
          return false;
        });
      }

      // Turning consent on also subscribes this browser, so the common case is
      // still one gesture, and subscribing on its own then only ever touches
      // this browser.
      //
      // What this browser reports moves on the answer, not ahead of it. The
      // reader is holding an OS prompt open, and consent cannot land until its
      // write does, so reporting a subscription first would draw a cell on
      // beside its own "push is off for your account" for as long as the
      // prompt is up.
      return runSave(async (sessionUserId) => {
        // Register the device first. If the Core write then fails, the device
        // is known to Ably but Core sends nothing, so the reader gets silence
        // rather than banners they never consented to.
        //
        // A refused prompt is not a failure here. The reader asked for push on
        // their account, and answered for this browser only, so consent goes
        // in and this browser stays out. The blocked branch above does the
        // same for a reader who refused it earlier.
        const subscribedHere = await subscribeThisBrowser(sessionUserId);
        setSubscriptionKnown(subscribedHere);
        await recordAccountOptIn(true);
        return subscribedHere;
      });
    },
    [
      canSubscribeHere,
      recordAccountOptIn,
      runSave,
      setSubscriptionKnown,
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
    // Consent is the master switch: with it withdrawn, no device receives
    // anything, so subscribing here would buy the reader nothing.
    canToggleDevice: hasSession && canSubscribeHere && isAccountEnabled,
    isSaving,
    setAccountEnabled,
    setDeviceEnabled,
  };
}
