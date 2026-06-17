"use client";

import { SokosumiJobStatus, TaskStatus } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ConversationStatusBadge } from "@/app/history/components/conversation-status-badge";
import { getHistoryItemHref } from "@/app/history/components/history-list-item";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import { getDefaultHistoryScope } from "@/app/history/utils/history-filters";
import {
  buildHistoryBucketLookupsFromItems,
  type CoworkerBucketSource,
  createEmptyHistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";

const HISTORY_SEARCH_PAGE_SIZE = 50;
const SEARCH_STATUS_BADGE_CLASSNAME = "ml-auto shrink-0";

interface HistorySearchDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  empty: string;
  loading: string;
  error: string;
  kind: {
    task: string;
    job: string;
    conversation: string;
  };
  conversationStatus: {
    active: string;
    archived: string;
  };
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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [coworkers, setCoworkers] = useState<CoworkerBucketSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const router = useRouter();

  const loadCoworkers = useEffectEvent(async () => {
    try {
      const response = await coreClient.getCoworkers();
      setCoworkers(response.data);
    } catch {
      setCoworkers([]);
    }
  });

  const loadHistory = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    const scope = getDefaultHistoryScope(activeOrganizationId);
    setIsLoading(true);
    setError(null);
    setHistory([]);

    try {
      const response = await coreClient.getHistory({
        q: searchQuery || undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope,
      });

      if (requestId !== requestIdRef.current) return;

      setHistory(response.data);
    } catch {
      if (requestId !== requestIdRef.current) return;

      setHistory([]);
      setError(labels.error);
    } finally {
      if (requestId !== requestIdRef.current) return;

      setIsLoading(false);
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    void loadCoworkers();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    void loadHistory(debouncedQuery);
  }, [activeOrganizationId, debouncedQuery, open]);

  const bucketLookups = useMemo(
    () =>
      history.length > 0
        ? buildHistoryBucketLookupsFromItems(history, coworkers)
        : createEmptyHistoryBucketLookups(),
    [coworkers, history],
  );

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setQuery("");
      setDebouncedQuery("");
      setHistory([]);
      setCoworkers([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }

    onOpenChange(nextOpen);
  }

  function handleSelect(item: HistoryItem) {
    const href = getHistoryItemHref(item);
    // Use the same close path as the dialog itself so we reset state
    // and ignore any in-flight history requests.
    handleOpenChange(false);
    router.push(href);
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
              >
                <HistoryTypeIcon
                  item={item}
                  labels={labels}
                  bucketLookups={bucketLookups}
                />
                <span className="truncate">{item.title}</span>
                <HistoryItemStatus item={item} labels={labels} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

function HistoryItemStatus({
  item,
  labels,
}: {
  item: HistoryItem;
  labels: HistorySearchDialogLabels;
}) {
  if (item.kind === "task") {
    const status = item.status as TaskStatus;
    return (
      <TaskStatusBadge
        status={status}
        className={SEARCH_STATUS_BADGE_CLASSNAME}
      />
    );
  }

  if (item.kind === "job") {
    return (
      <JobStatusBadge
        status={item.status as SokosumiJobStatus}
        className={SEARCH_STATUS_BADGE_CLASSNAME}
      />
    );
  }

  return (
    <ConversationStatusBadge
      status={item.status}
      label={labels.conversationStatus[item.status]}
      className={SEARCH_STATUS_BADGE_CLASSNAME}
    />
  );
}
