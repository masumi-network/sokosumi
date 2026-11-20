"use client";

import type {
  GetTasksResponse,
  UserWritableTaskLinkRelation,
} from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";

import {
  mapTaskListItemToTaskPickerTask,
  type TaskPickerTask,
} from "./task-detail-api-types";

const TASK_PICKER_PAGE_SIZE = 20;

/** What a picked Task is for: a link relation, or a sub-task move. */
export interface TaskPickerOption {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The picker's visible title, e.g. "Link as related". */
  title: string;
  /** One line under the title on what picking a Task does. */
  description: string;
  /** Also lists sub-tasks, which the plain Task list leaves out. */
  includeSubtasks?: boolean;
}

export interface TaskLinkActionOption extends TaskPickerOption {
  relation: UserWritableTaskLinkRelation;
}

interface TaskLinkTaskPickerDialogProps<TOption extends TaskPickerOption> {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOption: TOption | null;
  isLinkPending: boolean;
  onSelectTask: (option: TOption, task: TaskPickerTask) => void;
  /** Tasks the pick may not be, besides `taskId`. */
  excludeTaskIds?: readonly string[];
  /** Where focus goes on close; Radix's default is the opening element. */
  onCloseAutoFocus?: (event: Event) => void;
}

type TaskPickerBodyProps<TOption extends TaskPickerOption> = Omit<
  TaskLinkTaskPickerDialogProps<TOption>,
  "open" | "onOpenChange" | "onCloseAutoFocus"
>;

export function TaskLinkTaskPickerDialog<TOption extends TaskPickerOption>({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...bodyProps
}: TaskLinkTaskPickerDialogProps<TOption>) {
  const { selectedOption } = bodyProps;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={selectedOption?.title ?? ""}
      description={selectedOption?.description ?? ""}
      showHeader
      commandProps={{ shouldFilter: false }}
    >
      {/* Mounted only while open, so every opening starts with an empty search. */}
      <TaskPickerBody {...bodyProps} />
    </CommandDialog>
  );
}

function TaskPickerBody<TOption extends TaskPickerOption>({
  taskId,
  selectedOption,
  isLinkPending,
  onSelectTask,
  excludeTaskIds = [],
}: TaskPickerBodyProps<TOption>) {
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [debouncedTaskPickerQuery] = useDebounce(taskPickerQuery.trim(), 250);
  const includeSubtasks = Boolean(selectedOption?.includeSubtasks);

  const tasksQuery = useInfiniteQuery({
    queryKey: [
      "tasks",
      "link-picker",
      taskId,
      includeSubtasks,
      debouncedTaskPickerQuery,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await coreClient.getTasks({
        q: debouncedTaskPickerQuery || undefined,
        cursor: pageParam,
        limit: TASK_PICKER_PAGE_SIZE,
        ...(includeSubtasks ? { includeSubtasks: "true" as const } : {}),
      })) as GetTasksResponse,
    getNextPageParam: (lastPage) =>
      lastPage.meta?.pagination?.nextCursor ?? undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const taskPickerResults: TaskPickerTask[] = (tasksQuery.data?.pages ?? [])
    .flatMap((page) => page.data)
    .map(mapTaskListItemToTaskPickerTask)
    .filter(
      (taskOption) =>
        taskOption.id !== taskId && !excludeTaskIds.includes(taskOption.id),
    );
  const isTaskPickerLoading = tasksQuery.isPending;
  const isTaskPickerLoadingMore = tasksQuery.isFetchingNextPage;
  const taskPickerError = tasksQuery.isFetchNextPageError
    ? tDetailActions("taskPickerLoadMoreError")
    : tasksQuery.isError
      ? tDetailActions("taskPickerError")
      : null;

  function handleLoadMoreTaskOptions() {
    if (
      !tasksQuery.hasNextPage ||
      isTaskPickerLoadingMore ||
      isTaskPickerLoading
    ) {
      return;
    }

    void tasksQuery.fetchNextPage();
  }

  return (
    <>
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
          <CommandGroup>
            {taskPickerResults.map((taskOption) => {
              const PickerIcon = selectedOption?.icon ?? Link2;

              return (
                <CommandItem
                  key={taskOption.id}
                  value={`${taskOption.name} ${taskOption.id}`}
                  disabled={isLinkPending}
                  onSelect={() => {
                    if (!selectedOption) return;
                    onSelectTask(selectedOption, taskOption);
                  }}
                >
                  <PickerIcon className="size-4" aria-hidden />
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

        {tasksQuery.hasNextPage ? (
          <CommandItem
            value="load-more"
            disabled={isTaskPickerLoadingMore || isTaskPickerLoading}
            onSelect={handleLoadMoreTaskOptions}
          >
            {isTaskPickerLoadingMore ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-pulse"
                aria-hidden
              />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            <span>{tDetailActions("taskPickerLoadMore")}</span>
          </CommandItem>
        ) : null}
      </CommandList>
    </>
  );
}
