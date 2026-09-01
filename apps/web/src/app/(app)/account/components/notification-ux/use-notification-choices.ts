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
  type CategoryChoice,
  type CategoryGroup,
  type ChannelChoice,
  cellsFor,
  DISPLAY_CHANNELS,
  type DisplayChannel,
  derivedScope,
  type GroupLevel,
  type GroupLevelState,
  groupPresets,
  levelOf,
  type NotificationCategory,
  type PresetId,
  type PresetState,
  presetLevel,
  presetOf,
  presetScope,
  type StoredCell,
  type StoredChannel,
  scopeCategories,
  type TriState,
  tri,
} from "./notification-model";
import { GROUP_SCOPES } from "./notification-scopes";

const CATEGORY_LABEL_KEY: Record<NotificationCategory, string> = {
  JOB: "matrixCategoryJob",
  TASK: "matrixCategoryTask",
  CHAT_MENTION: "matrixCategoryChatMention",
  CHAT_DIRECT_MESSAGE: "matrixCategoryChatDirectMessage",
  SYSTEM: "matrixCategorySystem",
};

const STORED_CHANNEL_LABEL_KEY: Record<StoredChannel, string> = {
  IN_APP: "matrixChannelInApp",
  OS_BANNER: "matrixChannelOsBanner",
};

/** A record over the union, so a category Core adds fails to compile here. */
const CATEGORY_GROUP: Record<NotificationCategory, string> = {
  JOB: "JOB",
  TASK: "TASK",
  CHAT_MENTION: "CHAT",
  CHAT_DIRECT_MESSAGE: "CHAT",
  SYSTEM: "SYSTEM",
};

const GROUP_ORDER = ["TASK", "CHAT", "JOB", "SYSTEM"] as const;

const GROUP_COPY: Record<string, { label: string; description: string }> = {
  TASK: {
    label: "Tasks",
    description: "Work your coworkers hand back to you.",
  },
  CHAT: { label: "Chat", description: "Messages in rooms and direct." },
  JOB: { label: "Jobs", description: "Agent runs and their status." },
  SYSTEM: {
    label: "Requests and access",
    description: "Access asked for, and access decided.",
  },
};

function cellKey(category: NotificationCategory, channel: DisplayChannel) {
  return `${category}:${channel}`;
}

export interface NotificationChoices {
  groups: CategoryGroup[];
  isLoading: boolean;
  push: PushPreference;
  /** Which rung of the breadth ladder a group is on. */
  groupScope: (group: CategoryGroup) => number;
  setGroupScope: (group: CategoryGroup, index: number) => Promise<void>;
  /** The subjects the current breadth includes, in reading order. */
  inScope: (group: CategoryGroup) => CategoryChoice[];
  /** Where the in-scope subjects arrive, or `CUSTOM` when they disagree. */
  groupLevel: (group: CategoryGroup) => GroupLevelState;
  setGroupLevel: (group: CategoryGroup, level: GroupLevel) => Promise<void>;
  groupChannelState: (
    group: CategoryGroup,
    channel: DisplayChannel,
  ) => TriState;
  setGroupChannel: (
    group: CategoryGroup,
    channel: DisplayChannel,
    enabled: boolean,
  ) => Promise<void>;
  /** One channel of one subject. This is what creates a custom group. */
  setChannel: (
    category: NotificationCategory,
    channel: DisplayChannel,
    enabled: boolean,
  ) => Promise<void>;
  /** The presets that mean something different for this group. */
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
 * the thing being compared. The arithmetic over cells, rungs and presets is
 * next door in `notification-model.ts`, where it needs no React to be read.
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
  const [savingCells, setSavingCells] = useState<readonly string[]>([]);
  // The breadth a reader picked. Nothing stores a rung yet, and a group that is
  // off has no cells left to read one back from, so the choice is held here for
  // the visit. A shipped version needs a column; see the note in the PR.
  const [scopeChoice, setScopeChoice] = useState<Record<string, number>>({});

  const cells = preferences?.data.notificationPreferences ?? [];

  const bannerUnavailableReason =
    push.isSupported === false
      ? t("pushUnsupported")
      : push.isBlocked
        ? t("pushDeviceUnavailableDescription")
        : null;

  function channelChoice(
    category: NotificationCategory,
    channel: DisplayChannel,
  ): ChannelChoice {
    if (channel === "EMAIL") {
      return {
        channel,
        label: "Email",
        enabled: false,
        available: false,
        saving: false,
        unavailableReason:
          "Not built yet. Shown so the layout holds three channels.",
      };
    }

    const stored = cells.find(
      (candidate) =>
        candidate.category === category && candidate.channel === channel,
    );

    return {
      channel,
      label: t(STORED_CHANNEL_LABEL_KEY[channel]),
      enabled: stored?.enabled ?? false,
      available: stored !== undefined,
      saving: savingCells.includes(cellKey(category, channel)),
      unavailableReason:
        channel === "OS_BANNER" ? bannerUnavailableReason : null,
    };
  }

  const categories = [...new Set(cells.map((cell) => cell.category))];

  const groups: CategoryGroup[] = GROUP_ORDER.flatMap((groupId) => {
    const groupCategories = categories.filter(
      (category) => CATEGORY_GROUP[category] === groupId,
    );

    if (groupCategories.length === 0) {
      return [];
    }

    const scopes = GROUP_SCOPES[groupId];
    // A rung whose only category this account does not have would be a promise
    // the screen cannot keep. A rung with no categories at all is the drawn one.
    const rungs = (scopes?.rungs ?? []).filter(
      (rung) =>
        rung.categories.length === 0 ||
        rung.categories.some((category) => categories.includes(category)),
    );

    return [
      {
        id: groupId,
        label: GROUP_COPY[groupId]?.label ?? groupId,
        description: GROUP_COPY[groupId]?.description ?? "",
        categories: groupCategories.map((category) => ({
          category,
          label: t(CATEGORY_LABEL_KEY[category]),
          channels: DISPLAY_CHANNELS.map((channel) =>
            channelChoice(category, channel),
          ),
        })),
        rungs,
        defaultScope: Math.min(
          scopes?.defaultIndex ?? 0,
          Math.max(rungs.length - 1, 0),
        ),
      },
    ];
  });

  const storedCells: StoredCell[] = groups.flatMap((group) =>
    group.categories.flatMap((category) =>
      category.channels
        .filter((channel) => channel.available)
        .map((channel) => ({
          category: category.category,
          channel: channel.channel as StoredChannel,
          enabled: channel.enabled,
        })),
    ),
  );

  function groupCells(group: CategoryGroup) {
    const inGroup = group.categories.map((category) => category.category);
    return storedCells.filter((cell) => inGroup.includes(cell.category));
  }

  function groupScope(group: CategoryGroup) {
    const chosen = scopeChoice[group.id];

    if (chosen !== undefined) {
      return chosen;
    }

    const derived = derivedScope(group, groupCells(group));

    return derived === -1 ? group.defaultScope : derived;
  }

  function inScopeCategories(group: CategoryGroup) {
    return scopeCategories(group, groupScope(group));
  }

  /**
   * The cells the group controls speak for.
   *
   * Out-of-scope subjects are off by construction, so counting them would make
   * every narrowed group read as custom, and custom would stop meaning
   * anything.
   */
  function inScopeCells(group: CategoryGroup) {
    const wanted = inScopeCategories(group);
    return groupCells(group).filter((cell) => wanted.includes(cell.category));
  }

  function groupChannelState(group: CategoryGroup, channel: DisplayChannel) {
    return tri(inScopeCells(group).filter((cell) => cell.channel === channel));
  }

  function groupLevel(group: CategoryGroup) {
    return levelOf(groupCells(group), group, groupScope(group));
  }

  /**
   * Moving the ladder touches the subjects that move, and only those.
   *
   * A subject already being listened to keeps exactly the channels it had, so
   * widening chat cannot quietly switch a banner back on somewhere else. A
   * subject arriving takes the delivery its neighbours have; one arriving into
   * a silent group turns the bell on, because asking for it is a request to
   * hear it, not a request to store a subscription that goes nowhere.
   */
  function cellsForScope(group: CategoryGroup, index: number): StoredCell[] {
    const before = inScopeCategories(group);
    const after = scopeCategories(group, index);
    const level = groupLevel(group);

    function arriving(channel: StoredChannel) {
      if (level === "ALL") {
        return true;
      }

      if (level === "IN_APP" || level === "OFF") {
        return channel === "IN_APP";
      }

      return groupChannelState(group, channel) !== "off";
    }

    return groupCells(group).map((cell) => {
      if (!after.includes(cell.category)) {
        return { ...cell, enabled: false };
      }

      return before.includes(cell.category)
        ? cell
        : { ...cell, enabled: arriving(cell.channel) };
    });
  }

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
      console.error("Failed to activate push from a channel toggle", error);
      toast.error(t("pushError"));
    }
  }

  async function write(changes: readonly StoredCell[]) {
    if (changes.length === 0) {
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
    const keys = changes.map((change) =>
      cellKey(change.category, change.channel),
    );
    setSavingCells((saving) => [...saving, ...keys]);

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
      setSavingCells((saving) =>
        saving.filter((candidate) => !keys.includes(candidate)),
      );
    }
  }

  function rememberScope(group: CategoryGroup, index: number) {
    setScopeChoice((current) => ({ ...current, [group.id]: index }));
  }

  return {
    groups,
    isLoading: isPending,
    push,
    groupScope,
    setGroupScope: async (group, index) => {
      rememberScope(group, index);
      await write(cellsForScope(group, index));
    },
    inScope: (group) => {
      const wanted = inScopeCategories(group);
      return group.categories.filter((category) =>
        wanted.includes(category.category),
      );
    },
    groupLevel,
    setGroupLevel: (group, level) =>
      write(cellsFor(groupCells(group), group, groupScope(group), level)),
    groupChannelState,
    setGroupChannel: (group, channel, enabled) =>
      channel === "EMAIL"
        ? Promise.resolve()
        : write(
            inScopeCells(group)
              .filter((cell) => cell.channel === channel)
              .map((cell) => ({ ...cell, enabled })),
          ),
    setChannel: (category, channel, enabled) =>
      channel === "EMAIL"
        ? Promise.resolve()
        : write([{ category, channel, enabled }]),
    groupPresets,
    groupPreset: (group) =>
      presetOf(groupCells(group), group, groupScope(group)),
    setGroupPreset: async (group, preset) => {
      const scope = presetScope(group, preset) ?? groupScope(group);

      rememberScope(group, scope);
      await write(
        cellsFor(groupCells(group), group, scope, presetLevel(preset)),
      );
    },
    pagePreset: () => {
      const presets = groups.map((group) =>
        presetOf(groupCells(group), group, groupScope(group)),
      );
      const first = presets[0];

      return first && presets.every((preset) => preset === first)
        ? first
        : "CUSTOM";
    },
    setPagePreset: (preset) => {
      // Every cell this account has fits in one request, so the page cannot end
      // up half applied with the reader watching rows settle one by one.
      const changes = groups.flatMap((group) => {
        const scope = presetScope(group, preset) ?? groupScope(group);

        rememberScope(group, scope);

        return cellsFor(groupCells(group), group, scope, presetLevel(preset));
      });

      return write(changes);
    },
  };
}
