"use client";

import { useRouter } from "next/navigation";
import { HistorySearchItemStatus } from "@/app/components/history-search-item-status";
import { useHistorySearchCorpus } from "@/app/components/use-history-search-corpus";
import { getHistoryItemHref } from "@/app/history/components/history-list-item";
import {
  HistoryMetaTime,
  HistoryOwnerAvatar,
} from "@/app/history/components/history-meta";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface HistorySearchDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  empty: string;
  loading: string;
  error: string;
  updated: string;
}

interface HistorySearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: HistorySearchDialogLabels;
  activeOrganizationId: string | null;
}

export function HistorySearchDialog({
  open,
  onOpenChange,
  labels,
  activeOrganizationId,
}: HistorySearchDialogProps) {
  const router = useRouter();
  const { formatTimeAgo } = useLocalizedDateTime();
  const showOwner = activeOrganizationId !== null;
  const { query, setQuery, history, error, isLoading, reset } =
    useHistorySearchCorpus({
      open,
      activeOrganizationId,
      errorLabel: labels.error,
    });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset();
    }

    onOpenChange(nextOpen);
  }

  function handleSelect(item: HistoryItem) {
    const href = getHistoryItemHref(item);
    // Use the same close path as the dialog itself so we reset state
    // and ignore any in-flight history requests.
    handleOpenChange(false);
    if (href) {
      router.push(href);
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={labels.dialogTitle}
      description={labels.dialogDescription}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.loading}
          </div>
        ) : null}

        {!isLoading && error && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && history.length === 0 ? (
          <CommandEmpty>{labels.empty}</CommandEmpty>
        ) : null}

        {history.length > 0 ? (
          <CommandGroup heading={labels.dialogTitle}>
            {history.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.title} ${item.id}`}
                onSelect={() => handleSelect(item)}
                className="flex items-start gap-2"
              >
                <HistoryTypeIcon item={item} className="mt-0.5 size-4" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <HistoryMetaTime
                    updatedAt={item.updatedAt}
                    formatTimeAgo={formatTimeAgo}
                    updatedLabel={labels.updated}
                    className="text-muted-foreground/70 mt-0.5 block text-left text-xs sm:text-left"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 self-center">
                  {showOwner && (
                    <HistoryOwnerAvatar
                      owner={item.owner}
                      className="hidden sm:inline-flex"
                    />
                  )}
                  <HistorySearchItemStatus item={item} />
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
