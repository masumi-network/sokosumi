"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { NewTaskEmptyAction } from "@/app/components/new-task-empty-action.client";
import { loadMoreHistory } from "@/app/history/actions";
import {
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import type { HistoryFilters } from "@/app/history/utils/history-filters";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import type { TransactionHistoryItem } from "@/lib/services/history.service";

export interface HistoryListLabels {
  empty: {
    title: string;
    description: string;
  };
  loadMore: string;
  loading: string;
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
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <HistoryListItem
                  item={item}
                  labels={labels.row}
                  activeOrganizationId={activeOrganizationId}
                />
              </li>
            ))}
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
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
                {labels.loading}
              </>
            ) : (
              labels.loadMore
            )}
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
        action={<NewTaskEmptyAction />}
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
