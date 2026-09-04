"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { usePushPreference } from "@/lib/ably/use-push-preference";
import { useSession } from "@/lib/auth/auth.client";
import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";
import type {
  GetUsersByIdPreferencesResponse,
  NotificationPreference,
  PatchUsersByIdPreferencesResponse,
} from "@/lib/clients/generated/core";
import {
  getMyPreferencesQueryKey,
  getMyPreferencesQueryOptions,
} from "@/queries/preferences";
import {
  categoryChannels,
  cellsFor,
  type DeliveryChange,
  type GroupSpec,
  groupScope,
  type KindSpec,
  NOTIFICATION_GROUPS,
  type NotificationCategory,
  type PushBlock,
  type ScopeState,
  type StoredChannel,
} from "./notification-delivery";

export interface KindChoice {
  spec: KindSpec;
  channels: StoredChannel[];
  saving: boolean;
}

export interface GroupChoice {
  spec: GroupSpec;
  /** Which kinds arrive at all, or that the reader set them one by one. */
  scope: ScopeState;
  kinds: KindChoice[];
  saving: boolean;
}

export interface NotificationDelivery {
  groups: GroupChoice[];
  /**
   * Why this browser cannot show a push, when it cannot.
   *
   * Null covers both a browser that can and one that has not answered yet: the
   * capability read needs `window`, so it lands after the first paint, and a
   * column drawn dead in the meantime would tell every reader on every browser
   * that theirs cannot push.
   */
  pushBlock: PushBlock | null;
  /**
   * Whether any kind is asking for a push at all.
   *
   * The banner reads it with `pushBlock`: a browser that cannot show a push is
   * only worth saying something about while something is trying to arrive on
   * it. With every banner cell off, nothing is going wrong.
   */
  pushWanted: boolean;
  /** A push write is in flight, so the banner's button waits for it. */
  pushSaving: boolean;
  /**
   * Subscribes this browser, asking the browser for the permission if it has
   * not been asked. The same path a push cell takes, from the banner instead.
   */
  activatePush: () => Promise<void>;
  /**
   * An answer is still coming.
   *
   * Told apart from an answer with nothing in it, because the two want
   * different pages: one waits, and the other has to say so.
   *
   * A read that cannot run is not waiting. Without a session the preferences
   * query stays disabled, and a disabled query reports pending for as long as
   * the page is open, so asking it alone would wait for an answer nobody is
   * fetching.
   */
  loading: boolean;
  /**
   * Writes every named category, each on its own channels, in one request.
   *
   * One request rather than one per kind, so a preset cannot land half applied
   * with the reader watching its kinds settle one by one.
   */
  setDeliveries: (changes: readonly DeliveryChange[]) => Promise<void>;
}

/**
 * The notification kinds as the reader decides about them, and the one path
 * that writes them.
 *
 * Core answers with every cell resolved, so a kind it stops sending disappears
 * from this list without a second edit here. A group whose kinds are all
 * missing is dropped rather than drawn with nothing in it.
 */
export function useNotificationDelivery(): NotificationDelivery {
  const t = useTranslations("App.Account.Notifications");
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { data: preferences, isPending } = useQuery(
    getMyPreferencesQueryOptions(userId),
  );
  const push = usePushPreference(userId);
  const [saving, setSaving] = useState<readonly NotificationCategory[]>([]);

  const cells = preferences?.data.notificationPreferences ?? [];
  const present = new Set(cells.map((cell) => cell.category));

  const groups: GroupChoice[] = NOTIFICATION_GROUPS.flatMap((spec) => {
    const kinds = spec.kinds.filter((kind) => present.has(kind.category));

    if (kinds.length === 0) {
      return [];
    }

    return [
      {
        spec,
        scope: groupScope(cells, kinds),
        kinds: kinds.map((kind) => ({
          spec: kind,
          channels: categoryChannels(cells, kind.category),
          saving: saving.includes(kind.category),
        })),
        saving: kinds.some((kind) => saving.includes(kind.category)),
      },
    ];
  });

  /**
   * Writes the given cells into the cached matrix, leaving every other cell as
   * it stands. A rollback that restored a whole snapshot would undo a different
   * kind's write that landed while this one was in flight.
   */
  function paint(written: readonly NotificationPreference[]) {
    queryClient.setQueryData<GetUsersByIdPreferencesResponse>(
      getMyPreferencesQueryKey(userId),
      (current) =>
        current && {
          ...current,
          data: {
            ...current.data,
            notificationPreferences: current.data.notificationPreferences.map(
              (candidate) => {
                const next = written.find(
                  (cell) =>
                    cell.category === candidate.category &&
                    cell.channel === candidate.channel,
                );

                return next
                  ? { ...candidate, enabled: next.enabled }
                  : candidate;
              },
            ),
          },
        },
    );
  }

  /**
   * Turns push on from the control the reader actually pressed.
   *
   * Asking for a push is a clear enough request to prompt for the browser
   * permission. A refusal still records the preference: account consent and
   * this browser's subscription are separate, and dropping the preference
   * because one browser said no would be the wrong half to lose.
   *
   * Two things can be missing, and consent standing does not imply the other.
   * Signing out drops this browser's subscription and leaves consent where it
   * was, and clearing site data drops it without asking anyone. So a browser
   * that holds no subscription subscribes here, under the same press. Without
   * that, the cells would sit on and this browser would never push again.
   */
  async function activatePushIfNeeded() {
    // One push write at a time, across every row. The busy flag the rows hold
    // is per kind, so two kinds can ask within one write of each other: the
    // second would read the same stale answer as the first, subscribe on top
    // of it, and release the shared row while the first is still running.
    if (push.isSaving || !push.canToggleAccount) {
      return;
    }

    try {
      if (push.isAccountEnabled) {
        // `canToggleDevice` carries the rest of the answer: a session, a
        // browser that can subscribe, and consent already on.
        if (push.isDeviceEnabled || !push.canToggleDevice) {
          return;
        }

        await push.setDeviceEnabled(true);
        toast.success(t("pushEnabledSuccess"));
        return;
      }

      const subscribedHere = await push.setAccountEnabled(true);
      toast.success(
        subscribedHere
          ? t("pushEnabledSuccess")
          : t("pushEnabledOtherDevicesSuccess"),
      );
    } catch (error) {
      // A refused prompt lands here as well, and reads as a failure on
      // purpose: the reader asked this browser for a push and will not get
      // one. The cell itself carries the reason from the next render on.
      console.error("Failed to activate push from a delivery control", error);
      toast.error(t("pushError"));
    }
  }

  /**
   * Takes the account-wide consent back once no kind is left on the banner.
   *
   * Consent and the cells are two separate answers, and Core's publish gate
   * reads both, so clearing every banner cell already stops every push. What
   * stays behind is the consent, which nothing else on this page writes: a
   * reader who silenced push row by row would keep an account that still says
   * push is welcome, until they sign out. It is released here so the two
   * answers say the same thing.
   *
   * Read from the stored matrix rather than this write, because the answer is
   * about every kind and a write covers one group at a time.
   *
   * A failure is logged and no more than that. The reader's own write landed,
   * no push arrives either way, and a toast would report a failure against
   * something they did not ask for.
   */
  async function releasePushIfSilent(
    stored: PatchUsersByIdPreferencesResponse,
  ) {
    const silent = stored.data.notificationPreferences.every(
      (cell) => cell.channel !== "OS_BANNER" || !cell.enabled,
    );

    // Same one-write-at-a-time rule the activation keeps, and the same reason.
    if (
      !silent ||
      !push.isAccountEnabled ||
      !push.canToggleAccount ||
      push.isSaving
    ) {
      return;
    }

    try {
      await push.setAccountEnabled(false);
    } catch (error) {
      console.error("Failed to release the push consent", error);
    }
  }

  async function setDeliveries(changes: readonly DeliveryChange[]) {
    const categories = changes.map((change) => change.category);
    const written = cellsFor(cells, changes);

    if (written.length === 0) {
      return;
    }

    const previous = written.map((change) => ({
      ...change,
      enabled:
        cells.find(
          (cell) =>
            cell.category === change.category &&
            cell.channel === change.channel,
        )?.enabled ?? false,
    }));

    // Every push needs the account-wide opt-in, so a write that leaves one on
    // asks for it. Asking only about a cell this write turns on would miss the
    // reader whose push cells were on from the start, which is where a reader
    // starts: nothing would ever prompt, and no push would arrive.
    const asksForPush = written.some(
      (change) => change.channel === "OS_BANNER" && change.enabled,
    );

    // Marked busy before the prompt, which waits on a person. A second press
    // on the same group while it stands would land its write, then have this
    // one overwrite it on the way back.
    setSaving((current) => [...current, ...categories]);

    try {
      if (asksForPush) {
        await activatePushIfNeeded();
      }

      // Painted after the consent, never before it. Recording the consent
      // seeds this same cache with the answer its own write returned, and
      // that answer predates this one: painting first would show the new
      // delivery, then drop back to the old one under a busy row.
      paint(written);

      const stored = await preferencesBrowserClient.patchMyPreferences({
        notificationPreferences: written.map((cell) => ({
          category: cell.category,
          channel: cell.channel,
          enabled: cell.enabled,
        })),
      });

      // A read that started before this write can answer after it, carrying
      // the matrix as it stood before.
      await queryClient.cancelQueries({
        queryKey: getMyPreferencesQueryKey(userId),
      });
      queryClient.setQueryData(getMyPreferencesQueryKey(userId), stored);

      await releasePushIfSilent(stored);
    } catch (error) {
      console.error("Failed to update the notification preference", error);
      paint(previous);
      toast.error(t("error"));

      // The cache notifies its readers on a macrotask, so this rollback is
      // not on screen yet, and the busy flag below is plain state that lands
      // sooner. A row reads "the write settled" from that flag and says where
      // the kind arrives now: cleared first, it would read the channels the
      // write failed to store and report them as stored, then fall silent
      // when the rollback took the sentence back down. Same delay, queued
      // after the cache's, so the flag follows the paint.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    } finally {
      setSaving((current) =>
        current.filter((candidate) => !categories.includes(candidate)),
      );
    }
  }

  /**
   * Why no push arrives on this browser, when none does.
   *
   * `isSupported` is null until the mount read lands, so only an explicit
   * false is an answer. A blocked browser can be told apart from one that
   * cannot push at all, and the two need different words.
   *
   * A browser that can push and holds no subscription is the third: consent
   * stands, the cells are on, and nothing reaches this browser until a press
   * subscribes it again. `canToggleDevice` carries the rest of that sentence,
   * a session and standing consent included, and `isDeviceKnown` keeps the
   * mount read from reporting every browser as missing on the first paint.
   */
  const pushBlock: PushBlock | null = readPushBlock();

  function readPushBlock(): PushBlock | null {
    if (push.isSupported === false) {
      return "unsupported";
    }

    if (push.isBlocked) {
      return "denied";
    }

    return push.canToggleDevice && push.isDeviceKnown && !push.isDeviceEnabled
      ? "unsubscribed"
      : null;
  }

  return {
    groups,
    pushBlock,
    pushWanted: cells.some(
      (cell) => cell.channel === "OS_BANNER" && cell.enabled,
    ),
    pushSaving: push.isSaving,
    activatePush: activatePushIfNeeded,
    loading: sessionPending || (Boolean(userId) && isPending),
    setDeliveries,
  };
}
