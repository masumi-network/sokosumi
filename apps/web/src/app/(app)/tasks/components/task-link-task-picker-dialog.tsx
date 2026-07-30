"use client";

import type { LucideIcon } from "lucide-react";
import { Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";
import type {
  GetTasksResponse,
  UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";

import {
  mapTaskListItemToTaskPickerTask,
  type TaskPickerTask,
} from "./task-detail-api-types";

const TASK_PICKER_PAGE_SIZE = 20;

export interface TaskLinkActionOption {
  id: string;
  label: string;
  relation: UserWritableTaskLinkRelation;
  icon: LucideIcon;
}

interface TaskLinkTaskPickerDialogProps {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOption: TaskLinkActionOption | null;
  isLinkPending: boolean;
  pendingLinkTaskId: string | null;
  onSelectTask: (option: TaskLinkActionOption, relatedTaskId: string) => void;
}

export function TaskLinkTaskPickerDialog({
  taskId,
  open,
  onOpenChange,
  selectedOption,
  isLinkPending,
  pendingLinkTaskId,
  onSelectTask,
}: TaskLinkTaskPickerDialogProps) {
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [debouncedTaskPickerQuery, setDebouncedTaskPickerQuery] = useState("");
  const [taskPickerResults, setTaskPickerResults] = useState<TaskPickerTask[]>(
    [],
  );
  const [taskPickerNextCursor, setTaskPickerNextCursor] = useState<
    string | null
  >(null);
  const [taskPickerError, setTaskPickerError] = useState<string | null>(null);
  const [isTaskPickerLoading, setIsTaskPickerLoading] = useState(false);
  const [isTaskPickerLoadingMore, setIsTaskPickerLoadingMore] = useState(false);
  const taskPickerRequestIdRef = useRef(0);

  const loadTaskPickerTasks = useEffectEvent(
    async ({
      query,
      cursor,
      append,
    }: {
      query: string;
      cursor?: string | null;
      append: boolean;
    }) => {
      const requestId = ++taskPickerRequestIdRef.current;

      if (append) {
        setIsTaskPickerLoadingMore(true);
      } else {
        setIsTaskPickerLoading(true);
      }

      setTaskPickerError(null);

      try {
        const response = (await coreClient.getTasks({
          q: query || undefined,
          cursor: cursor ?? undefined,
          limit: TASK_PICKER_PAGE_SIZE,
        })) as GetTasksResponse;

        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        const nextTasks = response.data
          .map(mapTaskListItemToTaskPickerTask)
          .filter((taskOption) => taskOption.id !== taskId);

        setTaskPickerResults((currentResults) =>
          append ? [...currentResults, ...nextTasks] : nextTasks,
        );
        setTaskPickerNextCursor(response.meta?.pagination?.nextCursor ?? null);
      } catch (_error) {
        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        const message = append
          ? tDetailActions("taskPickerLoadMoreError")
          : tDetailActions("taskPickerError");

        if (!append) {
          setTaskPickerResults([]);
          setTaskPickerNextCursor(null);
        }

        setTaskPickerError(message);
      } finally {
        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        if (append) {
          setIsTaskPickerLoadingMore(false);
        } else {
          setIsTaskPickerLoading(false);
        }
      }
    },
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedTaskPickerQuery(taskPickerQuery.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [taskPickerQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadTaskPickerTasks({
      query: debouncedTaskPickerQuery,
      append: false,
    });
  }, [debouncedTaskPickerQuery, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setTaskPickerQuery("");
      setDebouncedTaskPickerQuery("");
      setTaskPickerResults([]);
      setTaskPickerNextCursor(null);
      setTaskPickerError(null);
      setIsTaskPickerLoading(false);
      setIsTaskPickerLoadingMore(false);
      taskPickerRequestIdRef.current += 1;
    }
    onOpenChange(nextOpen);
  }

  function handleLoadMoreTaskOptions() {
    if (
      !taskPickerNextCursor ||
      isTaskPickerLoadingMore ||
      isTaskPickerLoading
    ) {
      return;
    }

    void loadTaskPickerTasks({
      query: debouncedTaskPickerQuery,
      cursor: taskPickerNextCursor,
      append: true,
    });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDetailActions("taskPickerTitle", {
        relation: selectedOption?.label ?? "",
      })}
      description={tDetailActions("taskPickerDescription")}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={tDetailActions("taskPickerSearchPlaceholder")}
        value={taskPickerQuery}
        onValueChange={setTaskPickerQuery}
      />
      <CommandList>
        {isTaskPickerLoading && taskPickerResults.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {tDetailActions("taskPickerLoading")}
          </div>
        ) : null}

        {!isTaskPickerLoading &&
        taskPickerError &&
        taskPickerResults.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {taskPickerError}
          </div>
        ) : null}

        {!isTaskPickerLoading &&
        !taskPickerError &&
        taskPickerResults.length === 0 ? (
          <CommandEmpty>{tDetailActions("taskPickerEmpty")}</CommandEmpty>
        ) : null}

        {taskPickerResults.length > 0 ? (
          <CommandGroup heading={selectedOption?.label}>
            {taskPickerResults.map((taskOption) => {
              const PickerIcon = selectedOption?.icon ?? Link2;

              return (
                <CommandItem
                  key={taskOption.id}
                  value={`${taskOption.name} ${taskOption.id}`}
                  disabled={isLinkPending}
                  onSelect={() => {
                    if (!selectedOption) return;
                    onSelectTask(selectedOption, taskOption.id);
                  }}
                >
                  {isLinkPending && pendingLinkTaskId === taskOption.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <PickerIcon className="size-4" aria-hidden />
                  )}
                  <span className="truncate">{taskOption.name}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {taskPickerResults.length > 0 && taskPickerError ? (
          <div className="text-muted-foreground px-2 py-3 text-sm">
            {taskPickerError}
          </div>
        ) : null}

        {taskPickerNextCursor ? (
          <CommandItem
            value="load-more"
            disabled={isTaskPickerLoadingMore || isTaskPickerLoading}
            onSelect={handleLoadMoreTaskOptions}
          >
            {isTaskPickerLoadingMore ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            <span>{tDetailActions("taskPickerLoadMore")}</span>
          </CommandItem>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
