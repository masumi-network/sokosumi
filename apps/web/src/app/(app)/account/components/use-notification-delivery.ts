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
  groupPreset,
  type KindSpec,
  NOTIFICATION_GROUPS,
  type NotificationCategory,
  type PresetState,
  type StoredChannel,
} from "./notification-delivery";

export interface KindChoice {
  spec: KindSpec;
  channels: StoredChannel[];
  saving: boolean;
}

export interface GroupChoice {
  spec: GroupSpec;
  /** Which of the group's own answers it is on, or that it is on none. */
  preset: PresetState;
  kinds: KindChoice[];
  saving: boolean;
}

export interface NotificationDelivery {
  groups: GroupChoice[];
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
        preset: groupPreset(cells, kinds),
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
   */
  async function activatePushIfNeeded() {
    if (push.isAccountEnabled || !push.canToggleAccount) {
      return;
    }

    try {
      const subscribedHere = await push.setAccountEnabled(true);
      toast.success(
        subscribedHere
          ? t("pushEnabledSuccess")
          : t("pushEnabledOtherDevicesSuccess"),
      );
    } catch (error) {
      console.error("Failed to activate push from a delivery control", error);
      toast.error(t("pushError"));
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
    } catch (error) {
      console.error("Failed to update the notification preference", error);
      paint(previous);
      toast.error(t("error"));
    } finally {
      setSaving((current) =>
        current.filter((candidate) => !categories.includes(candidate)),
      );
    }
  }

  return {
    groups,
    loading: sessionPending || (Boolean(userId) && isPending),
    setDeliveries,
  };
}
