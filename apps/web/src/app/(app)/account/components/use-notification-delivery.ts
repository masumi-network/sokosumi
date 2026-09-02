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
  categoryDelivery,
  cellsFor,
  type Delivery,
  type DeliveryChange,
  type GroupSpec,
  groupPreset,
  type KindSpec,
  NOTIFICATION_GROUPS,
  type NotificationCategory,
  type PresetState,
} from "./notification-delivery";

export interface KindChoice {
  spec: KindSpec;
  delivery: Delivery;
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
   * Writes every named category, each at its own loudness, in one request.
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
  const { data: session } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { data: preferences } = useQuery(getMyPreferencesQueryOptions(userId));
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
          delivery: categoryDelivery(cells, kind.category),
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
   * Asking for a banner is a clear enough request to prompt for the browser
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

    // Every banner needs the account-wide opt-in, so a write that leaves one
    // on asks for it. Asking only about a cell this write turns on would miss
    // the reader whose banner cells were on from the start, which is where a
    // reader starts: nothing would ever prompt, and no banner would arrive.
    const asksForBanner = written.some(
      (change) => change.channel === "OS_BANNER" && change.enabled,
    );

    if (asksForBanner) {
      await activatePushIfNeeded();
    }

    paint(written);
    setSaving((current) => [...current, ...categories]);

    try {
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

  return { groups, setDeliveries };
}
