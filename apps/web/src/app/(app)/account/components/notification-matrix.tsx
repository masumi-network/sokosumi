"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
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

/**
 * A label per category and per channel, as a record rather than a list, so a
 * name Core adds or renames fails to compile here instead of rendering a row
 * the reader cannot read.
 */
const CATEGORY_LABEL_KEY: Record<NotificationPreference["category"], string> = {
  JOB: "matrixCategoryJob",
  TASK: "matrixCategoryTask",
  CHAT_MENTION: "matrixCategoryChatMention",
  CHAT_DIRECT_MESSAGE: "matrixCategoryChatDirectMessage",
  SYSTEM: "matrixCategorySystem",
};

const CHANNEL_LABEL_KEY: Record<NotificationPreference["channel"], string> = {
  IN_APP: "matrixChannelInApp",
  OS_BANNER: "matrixChannelOsBanner",
};

/** Cell identity, for the pending set and for React keys. */
function cellKey(cell: Pick<NotificationPreference, "category" | "channel">) {
  return `${cell.category}:${cell.channel}`;
}

/**
 * The notification preference matrix: one row per category, one switch per
 * delivery channel.
 *
 * Core answers with every cell resolved, so the order and the completeness are
 * its call. Rendering the response as it arrives keeps a category added later
 * visible here without a second edit.
 */
export function NotificationMatrix() {
  const t = useTranslations("App.Account.Notifications");
  const { data: session } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { data: preferences } = useQuery(getMyPreferencesQueryOptions(userId));
  const [savingCells, setSavingCells] = useState<readonly string[]>([]);

  const cells = preferences?.data.notificationPreferences ?? [];
  const categories = [...new Set(cells.map((cell) => cell.category))];
  // `Object.entries` widens the key to `string`; the record's keys are the
  // channel union, so this narrows it back rather than asserting anything new.
  const channelEntries = Object.entries(CHANNEL_LABEL_KEY) as [
    NotificationPreference["channel"],
    string,
  ][];

  /**
   * Writes one cell and paints it at once, because a switch that waits for the
   * round trip reads as broken. The response is the whole matrix, so it seeds
   * the cache rather than costing a second read.
   */
  async function saveCell(cell: NotificationPreference, enabled: boolean) {
    const key = getMyPreferencesQueryKey(userId);

    /**
     * Writes one cell into the cached matrix, leaving every other cell as it
     * stands. A rollback that restored a whole snapshot would undo a different
     * cell's write that landed while this one was in flight.
     */
    function paintCell(next: boolean) {
      queryClient.setQueryData<GetUsersByIdPreferencesResponse>(
        key,
        (current) =>
          current && {
            ...current,
            data: {
              ...current.data,
              notificationPreferences: current.data.notificationPreferences.map(
                (candidate) =>
                  cellKey(candidate) === cellKey(cell)
                    ? { ...candidate, enabled: next }
                    : candidate,
              ),
            },
          },
      );
    }

    paintCell(enabled);
    setSavingCells((saving) => [...saving, cellKey(cell)]);

    try {
      const written = await preferencesBrowserClient.patchMyPreferences({
        notificationPreferences: [
          { category: cell.category, channel: cell.channel, enabled },
        ],
      });

      // A read that started before this write can answer after it, carrying
      // the matrix as it stood before.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, written);
    } catch (error) {
      console.error("Failed to update the notification preference", error);
      paintCell(cell.enabled);
      toast.error(t("error"));
    } finally {
      setSavingCells((saving) =>
        saving.filter((candidate) => candidate !== cellKey(cell)),
      );
    }
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm leading-5 font-medium">{t("matrixTitle")}</p>
        <p className="text-muted-foreground text-sm leading-6">
          {t("matrixDescription")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="sr-only">{t("matrixCategoryHeader")}</th>
              {channelEntries.map(([channel, labelKey]) => (
                <th
                  key={channel}
                  scope="col"
                  className="text-muted-foreground px-2 pb-2 text-right font-normal"
                >
                  {t(labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category}>
                <th
                  scope="row"
                  className="py-2 pr-2 text-left font-normal wrap-anywhere"
                >
                  {t(CATEGORY_LABEL_KEY[category])}
                </th>
                {channelEntries.map(([channel, channelLabelKey]) => {
                  // Looked up by channel rather than taken in the order the
                  // response lists them, so a column always holds the switch
                  // its header names.
                  const cell = cells.find(
                    (candidate) =>
                      candidate.category === category &&
                      candidate.channel === channel,
                  );

                  return (
                    <td key={channel} className="px-2 py-2 text-right">
                      {cell ? (
                        <Switch
                          checked={cell.enabled}
                          disabled={savingCells.includes(cellKey(cell))}
                          onCheckedChange={(next) => {
                            void saveCell(cell, next);
                          }}
                          aria-label={t("matrixCellAriaLabel", {
                            category: t(CATEGORY_LABEL_KEY[category]),
                            channel: t(channelLabelKey),
                          })}
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-sm leading-6">
        {t("matrixBannerHint")}
      </p>
    </div>
  );
}
