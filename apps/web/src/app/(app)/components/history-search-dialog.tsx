"use client";

import { SokosumiJobStatus, TaskStatus } from "@sokosumi/utils";
import { ListTodo } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ConversationStatusBadge } from "@/app/history/components/conversation-status-badge";
import { getHistoryItemHref } from "@/app/history/components/history-list-item";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { AgentIcon } from "@/components/agents/agent-icon";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
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
}

export function HistorySearchDialog({
  open,
  onOpenChange,
  labels,
}: HistorySearchDialogProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const router = useRouter();

  const loadHistory = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await coreClient.getHistory({
        q: searchQuery || undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
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

    void loadHistory(debouncedQuery);
  }, [debouncedQuery, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setQuery("");
      setDebouncedQuery("");
      setHistory([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }

    onOpenChange(nextOpen);
  }

  function handleSelect(item: HistoryItem) {
    const href = getHistoryItemHref(item);
    router.push(href);
    onOpenChange(false);
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
                <HistoryItemIcon item={item} labels={labels} />
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

function HistoryItemIcon({
  item,
  labels,
}: {
  item: HistoryItem;
  labels: HistorySearchDialogLabels;
}) {
  if (item.kind === "task") {
    return <ListTodo className="size-4" aria-hidden />;
  }

  if (item.kind === "job") {
    return (
      <AgentIcon
        agent={{
          name: item.agentName ?? item.title,
          icon: item.agentIcon ?? null,
        }}
        className="size-4"
      />
    );
  }

  return (
    <ChatModelIcon
      modelId=""
      modelName={labels.kind.conversation}
      className="size-4"
      size={16}
    />
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
