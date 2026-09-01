"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  type PushPreference,
  usePushPreference,
} from "@/lib/ably/use-push-preference";
import { useSession } from "@/lib/auth/auth.client";
import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";
import type { GetUsersByIdPreferencesResponse } from "@/lib/clients/generated/core";
import {
  getMyPreferencesQueryKey,
  getMyPreferencesQueryOptions,
} from "@/queries/preferences";
import {
  type CategoryGroup,
  cellsFor,
  type Delivery,
  deliveryOf,
  groupPreset,
  groupPresets,
  type PresetId,
  type PresetState,
  presetDelivery,
  resolve,
  type StoredCell,
} from "./notification-model";
import {
  GROUP_ORDER,
  GROUP_SUBJECTS,
  type SubjectSpec,
} from "./notification-subjects";

export interface NotificationChoices {
  groups: CategoryGroup[];
  isLoading: boolean;
  push: PushPreference;
  /** One row, one answer. Everything else on the screen is built from this. */
  setSubject: (spec: SubjectSpec, delivery: Delivery) => Promise<void>;
  groupPresets: (group: CategoryGroup) => PresetId[];
  groupPreset: (group: CategoryGroup) => PresetState;
  setGroupPreset: (group: CategoryGroup, preset: PresetId) => Promise<void>;
  /** The preset every group is on, or `CUSTOM` when they disagree. */
  pagePreset: () => PresetState;
  setPagePreset: (preset: PresetId) => Promise<void>;
}

/**
 * The state behind every notification settings layout on this page.
 *
 * One model, many views. The save path, the optimistic paint and the push
 * activation live here so the layouts differ only in how they look, which is
 * the thing being compared. The arithmetic over subjects, covering and presets
 * is next door in `notification-model.ts`, where it needs no React to be read.
 */
export function useNotificationChoices(): NotificationChoices {
  const t = useTranslations("App.Account.Notifications");
  const { data: session } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { data: preferences, isPending } = useQuery(
    getMyPreferencesQueryOptions(userId),
  );
  const push = usePushPreference(userId);
  const [saving, setSaving] = useState<readonly string[]>([]);
  // The subjects nothing stores yet. Held for the visit so the rows behave, and
  // deliberately not written: there is no column to write them to.
  const [drawn, setDrawn] = useState<Record<string, Delivery>>({});

  const cells: StoredCell[] = preferences?.data.notificationPreferences ?? [];

  function stored(spec: SubjectSpec) {
    return spec.categories.length > 0;
  }

  function own(spec: SubjectSpec): Delivery {
    return stored(spec) ? deliveryOf(cells, spec) : (drawn[spec.id] ?? "OFF");
  }

  const present = new Set(cells.map((cell) => cell.category));

  const groups: CategoryGroup[] = GROUP_ORDER.flatMap((groupId) => {
    const group = GROUP_SUBJECTS[groupId];

    if (!group) {
      return [];
    }

    // A subject whose categories this account does not have would be a promise
    // the screen cannot keep. One with no categories at all is the drawn kind.
    const specs = group.subjects.filter(
      (spec) =>
        spec.categories.length === 0 ||
        spec.categories.some((category) => present.has(category)),
    );

    if (specs.every((spec) => !stored(spec))) {
      return [];
    }

    return [
      {
        id: groupId,
        label: group.label,
        subjects: resolve(specs, own).map((subject) => ({
          ...subject,
          stored: stored(subject.spec),
          saving: saving.includes(subject.spec.id),
        })),
      },
    ];
  });

  function paint(written: readonly StoredCell[]) {
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
   * Turns push on from the control the reader actually clicked.
   *
   * The account switch is no longer the only way in: asking for a banner is a
   * clear enough request to prompt for the permission. A refusal still records
   * the preference, because account consent and this browser's subscription are
   * separate axes, and losing the reader's choice because one browser said no
   * would be the wrong half to drop.
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

  async function write(changes: readonly StoredCell[], touched: string[]) {
    if (changes.length === 0) {
      // A subject nothing stores still has to answer the click.
      return;
    }

    const previous = changes.map((change) => ({
      ...change,
      enabled:
        cells.find(
          (cell) =>
            cell.category === change.category &&
            cell.channel === change.channel,
        )?.enabled ?? false,
    }));

    // A banner that was already on is not a new request, so a wide write that
    // happens to carry one must not put a permission prompt on the screen.
    const asksForBanner = changes.some(
      (change, index) =>
        change.channel === "OS_BANNER" &&
        change.enabled &&
        !previous[index]?.enabled,
    );

    if (asksForBanner) {
      await activatePushIfNeeded();
    }

    paint(changes);
    setSaving((current) => [...current, ...touched]);

    try {
      const written = await preferencesBrowserClient.patchMyPreferences({
        notificationPreferences: changes.map((change) => ({
          category: change.category,
          channel: change.channel,
          enabled: change.enabled,
        })),
      });

      // A read that started before this write can answer after it, carrying
      // the matrix as it stood before.
      await queryClient.cancelQueries({
        queryKey: getMyPreferencesQueryKey(userId),
      });
      queryClient.setQueryData(getMyPreferencesQueryKey(userId), written);
    } catch (error) {
      console.error("Failed to update the notification preference", error);
      paint(previous);
      toast.error(t("error"));
    } finally {
      setSaving((current) =>
        current.filter((candidate) => !touched.includes(candidate)),
      );
    }
  }

  function remember(spec: SubjectSpec, delivery: Delivery) {
    setDrawn((current) => ({ ...current, [spec.id]: delivery }));
  }

  return {
    groups,
    isLoading: isPending,
    push,
    setSubject: async (spec, delivery) => {
      if (!stored(spec)) {
        remember(spec, delivery);
        return;
      }

      await write(cellsFor(cells, spec, delivery), [spec.id]);
    },
    groupPresets: (group) =>
      groupPresets(group.subjects.map((subject) => subject.spec)),
    groupPreset,
    setGroupPreset: async (group, preset) => {
      const changes = group.subjects.flatMap((subject) => {
        const delivery = presetDelivery(preset, subject.spec);

        if (!subject.stored) {
          remember(subject.spec, delivery);
          return [];
        }

        return cellsFor(cells, subject.spec, delivery);
      });

      await write(
        changes,
        group.subjects.map((subject) => subject.spec.id),
      );
    },
    pagePreset: () => {
      const presets = groups.map((group) => groupPreset(group));
      const first = presets[0];

      return first && presets.every((preset) => preset === first)
        ? first
        : "CUSTOM";
    },
    setPagePreset: (preset) => {
      // Every cell this account has fits in one request, so the page cannot end
      // up half applied with the reader watching rows settle one by one.
      const changes = groups.flatMap((group) =>
        group.subjects.flatMap((subject) => {
          const delivery = presetDelivery(preset, subject.spec);

          if (!subject.stored) {
            remember(subject.spec, delivery);
            return [];
          }

          return cellsFor(cells, subject.spec, delivery);
        }),
      );

      return write(
        changes,
        groups.flatMap((group) =>
          group.subjects.map((subject) => subject.spec.id),
        ),
      );
    },
  };
}
