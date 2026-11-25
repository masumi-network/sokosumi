"use client";

import type {
  GetTasksResponse,
  UserWritableTaskLinkRelation,
} from "@sokosumi/core-client";
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
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";

import {
  mapTaskListItemToTaskPickerTask,
  type TaskPickerTask,
} from "./task-detail-api-types";

const TASK_PICKER_PAGE_SIZE = 20;
const TASK_PICKER_SEARCH_DEBOUNCE_MS = 250;

let nextOpeningId = 0;

type TaskLinkPickerScope = readonly [
  workspaceId: string,
  viewerId: string | null,
];

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
  workspaceId: string;
  viewerId?: string | null;
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
  workspaceId,
  viewerId = null,
  selectedOption,
  isLinkPending,
  onSelectTask,
  excludeTaskIds = [],
}: TaskPickerBodyProps<TOption>) {
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const [openingId] = useState(() => ++nextOpeningId);
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [debouncedTaskPickerQuery] = useDebounce(
    taskPickerQuery.trim(),
    TASK_PICKER_SEARCH_DEBOUNCE_MS,
  );
  const includeSubtasks = Boolean(selectedOption?.includeSubtasks);
  const scope: TaskLinkPickerScope = [workspaceId, viewerId];

  const {
    data,
    error,
    hasNextPage,
    isPending,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useScopedInfiniteQuery({
    scope,
    queryKey: [
      "task-link-picker",
      openingId,
      { q: debouncedTaskPickerQuery, includeSubtasks },
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal, queryKey }) => {
      signal.throwIfAborted();
      const [[expectedWorkspaceId, expectedViewerId]] = queryKey;
      const response = (await coreClient.getTasks({
        q: debouncedTaskPickerQuery || undefined,
        cursor: pageParam ?? undefined,
        limit: TASK_PICKER_PAGE_SIZE,
        ...(includeSubtasks ? { includeSubtasks: "true" as const } : {}),
      })) as GetTasksResponse;
      signal.throwIfAborted();
      if (
        response.data.some(
          (task) =>
            (task.workspaceId && task.workspaceId !== expectedWorkspaceId) ||
            (expectedViewerId &&
              task.ownerId &&
              task.ownerId !== expectedViewerId),
        )
      ) {
        throw new Error("Active workspace changed");
      }

      return {
        tasks: response.data.map(mapTaskListItemToTaskPickerTask),
        nextCursor: response.meta?.pagination?.nextCursor ?? null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    gcTime: 0,
  });

  const taskPickerResults = (data?.pages ?? [])
    .flatMap((page) => page.tasks)
    .filter(
      (taskOption) =>
        taskOption.id !== taskId && !excludeTaskIds.includes(taskOption.id),
    );
  const isInitialLoading =
    isPending ||
    (Boolean(error) &&
      isFetching &&
      !isFetchingNextPage &&
      taskPickerResults.length === 0);
  const taskPickerError =
    error && !isFetching
      ? isFetchNextPageError
        ? tDetailActions("taskPickerLoadMoreError")
        : tDetailActions("taskPickerError")
      : null;

  function handleLoadMoreTaskOptions() {
    if (!hasNextPage || isFetchingNextPage || isFetching) {
      return;
    }

    void fetchNextPage();
  }

  return (
    <>
      <CommandInput
        placeholder={tDetailActions("taskPickerSearchPlaceholder")}
        value={taskPickerQuery}
        onValueChange={setTaskPickerQuery}
      />
      <CommandList>
        {isInitialLoading && taskPickerResults.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {tDetailActions("taskPickerLoading")}
          </div>
        ) : null}

        {!isInitialLoading &&
        taskPickerError &&
        taskPickerResults.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {taskPickerError}
          </div>
        ) : null}

        {!isInitialLoading &&
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

        {hasNextPage ? (
          <CommandItem
            value="load-more"
            disabled={isFetchingNextPage || isFetching}
            onSelect={handleLoadMoreTaskOptions}
          >
            {isFetchingNextPage ? (
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
