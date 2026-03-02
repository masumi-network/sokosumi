"use client";

import { useTranslations } from "next-intl";

import type { FeedItem } from "@/lib/services/feed.service";
import { getDateGroupKey } from "@/lib/utils/datetime";

import { FeedResultCard } from "./feed-result-card";

interface FeedResultsListProps {
  emptyLabel: string;
  items: FeedItem[];
}

export function FeedResultsList({ emptyLabel, items }: FeedResultsListProps) {
  const t = useTranslations("App.Feed");
  const groups = items.reduce<
    Array<{ key: string; label: string; items: FeedItem[] }>
  >((acc, item) => {
    const label = getDateGroupKey(new Date(item.activityAt)) ?? t("earlier");
    const existingGroup = acc.at(-1);

    if (!existingGroup || existingGroup.key !== label) {
      acc.push({
        key: label,
        label,
        items: [item],
      });
      return acc;
    }

    existingGroup.items.push(item);
    return acc;
  }, []);

  return (
    <section className="space-y-3">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col space-y-6">
          {groups.map((group) => (
            <div key={group.key} className="space-y-6">
              <div className="flex items-center gap-3">
                <p className="text-muted-foreground text-xs whitespace-nowrap">
                  {group.label}
                </p>
                <div className="bg-border h-px flex-1" />
              </div>
              <div className="flex flex-col space-y-3">
                {group.items.map((item) => (
                  <FeedResultCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
