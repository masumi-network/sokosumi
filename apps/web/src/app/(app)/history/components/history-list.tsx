"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { NewTaskButton } from "@/app/components/new-task-button.client";
import { loadMoreHistory } from "@/app/history/actions";
import {
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import { HistorySokoBotGroup } from "@/app/history/components/history-soko-bot-group";
import {
  groupSokoBotTurns,
  type HistoryEntry,
} from "@/app/history/utils/group-soko-bot-turns";
import type { HistoryFilters } from "@/app/history/utils/history-filters";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import type { TransactionHistoryItem } from "@/lib/services/history.service";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface HistoryListLabels {
  empty: {
    title: string;
    description: string;
  };
  loadMore: string;
  loadMoreError: string;
  row: HistoryListItemLabels;
}

interface HistoryListProps {
  history: TransactionHistoryItem[];
  nextCursor: string | null;
  filterResetKey: string;
  filters: HistoryFilters;
  labels: HistoryListLabels;
  activeOrganizationId: string | null;
}

export function HistoryList({
  history,
  nextCursor,
  filterResetKey,
  filters,
  labels,
  activeOrganizationId,
}: HistoryListProps) {
  const [items, setItems] = useState(history);
  const [cursor, setCursor] = useState(nextCursor);
  const [isPending, startTransition] = useTransition();
  const { formatMonthYear } = useLocalizedDateTime();
  const entries = useMemo(
    () => groupSokoBotTurns(items, (date) => new Date(date).toDateString()),
    [items],
  );
  const hasHistory = items.length > 0;
  const showEmptyState = !hasHistory && !isPending;

  function handleLoadMore() {
    if (!cursor || isPending) return;

    startTransition(async () => {
      try {
        const result = await loadMoreHistory({ cursor, filters });
        setItems((prev) => appendUniqueHistoryItems(prev, result.history));
        setCursor(result.nextCursor);
      } catch {
        toast.error(labels.loadMoreError);
      }
    });
  }

  return (
    <div key={filterResetKey} className="flex flex-col gap-5">
      {hasHistory ? (
        <div className="bg-card-background overflow-hidden rounded-xl p-2">
          <ul className="flex flex-col gap-2">
            {entries.map((entry, index) => {
              const at = entryDate(entry);
              const month = formatMonthYear(at);
              // Newest first, so a heading opens each run of one month.
              const startsMonth =
                index === 0 ||
                month !== formatMonthYear(entryDate(entries[index - 1]));

              return (
                <Fragment key={entryKey(entry)}>
                  {startsMonth ? (
                    <li
                      role="presentation"
                      className="text-muted-foreground px-2 pt-3 text-sm font-medium first:pt-1"
                    >
                      <h2>{month}</h2>
                    </li>
                  ) : null}
                  <li>
                    {entry.type === "item" ? (
                      <HistoryListItem
                        item={entry.item}
                        labels={labels.row}
                        activeOrganizationId={activeOrganizationId}
                      />
                    ) : (
                      <HistorySokoBotGroup
                        items={entry.items}
                        credits={entry.credits}
                        labels={labels.row}
                        activeOrganizationId={activeOrganizationId}
                      />
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : showEmptyState ? (
        <HistoryEmptyState labels={labels.empty} />
      ) : null}

      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            loading={isPending}
          >
            {labels.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HistoryEmptyState({ labels }: { labels: HistoryListLabels["empty"] }) {
  return (
    <div className="bg-card-background flex min-h-[320px] flex-col justify-center rounded-xl">
      <EmptyState
        title={labels.title}
        description={labels.description}
        action={<NewTaskButton />}
      />
    </div>
  );
}

function appendUniqueHistoryItems(
  prev: TransactionHistoryItem[],
  next: TransactionHistoryItem[],
): TransactionHistoryItem[] {
  const existingKeys = new Set(prev.map((item) => `${item.kind}:${item.id}`));
  const uniqueItems = next.filter(
    (item) => !existingKeys.has(`${item.kind}:${item.id}`),
  );

  return [...prev, ...uniqueItems];
}

function entryDate(entry: HistoryEntry): Date {
  return entry.type === "item"
    ? entry.item.consumedAt
    : entry.items[0].consumedAt;
}

function entryKey(entry: HistoryEntry): string {
  return entry.type === "item"
    ? `${entry.item.kind}:${entry.item.id}`
    : `sokoBotDay:${entry.key}`;
}
