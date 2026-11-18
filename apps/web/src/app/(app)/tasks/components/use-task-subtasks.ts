"use client";

import type { TaskStatus } from "@sokosumi/core-client";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import {
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
  toSubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { createSubtask, moveSubtask } from "@/lib/actions/task/subtask-action";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { CoworkerOption } from "@/lib/types/coworker";

export function taskSubtasksQueryKey(parentTaskId: string) {
  return ["task-subtasks", parentTaskId] as const;
}

/**
 * Reads again the checklists of the parents a change touched, except the open
 * page's own. The action already re-renders that page with newer rows, and a
 * read here could land before a toggle in flight and undo it on screen. The
 * other lists are not on screen, so this only marks them stale.
 */
export function invalidateSubtaskLists(
  queryClient: QueryClient,
  pageTaskId: string,
  parentTaskIds: readonly (string | null | undefined)[],
) {
  for (const id of new Set(parentTaskIds)) {
    if (id && id !== pageTaskId)
      void queryClient.invalidateQueries({
        queryKey: taskSubtasksQueryKey(id),
      });
  }
}

/**
 * Core's own words for a refusal, such as a cycle or a tree too deep. Any
 * other failure keeps its raw text, such as "fetch failed", off the toast.
 */
export function refusalDescription(error: ActionError): string | undefined {
  if (error.code === CommonErrorCode.INTERNAL_SERVER_ERROR) return undefined;
  return error.message || undefined;
}

/** What the "Add sub-task" dialog asks for. */
export interface NewSubtaskDraft {
  name: string;
  assignee: CoworkerOption | null;
  /** `YYYY-MM-DD`. */
  dueOn: string | null;
}

/** Creates `draft` as the last sub-task of `parentTaskId`. */
export function createSubtaskFromDraft(
  parentTaskId: string,
  draft: NewSubtaskDraft,
) {
  return createSubtask({
    parentTaskId,
    name: draft.name,
    ...resolveTaskAssigneeFields(
      draft.assignee?.id,
      draft.assignee ? [draft.assignee] : [],
    ),
    dueOn: draft.dueOn,
  });
}

/**
 * Adds a sub-task from the dialog. The dialog waits for the answer: it closes
 * on success and keeps the draft when Core refuses.
 */
export function useCreateSubtask(parentTaskId: string) {
  const t = useTranslations("App.Tasks.Detail.actions.subtasks");

  return async function handleCreate(draft: NewSubtaskDraft): Promise<boolean> {
    try {
      const result = await createSubtaskFromDraft(parentTaskId, draft);
      if (!result.ok) {
        toast.error(t("createError"), {
          description: refusalDescription(result.error),
        });
        return false;
      }
      toast.success(t("createSuccess"));
      return true;
    } catch (error) {
      console.error("Failed to create sub-task", error);
      toast.error(t("createError"));
      return false;
    }
  };
}

export type SubtaskChange =
  | { kind: "status"; id: string; status: TaskStatus; comment?: string }
  | { kind: "move"; id: string; ids: string[] };

/** The checklist as it looks once `change` lands. */
export function applySubtaskChange(
  rows: SubtaskRow[],
  change: SubtaskChange,
): SubtaskRow[] {
  switch (change.kind) {
    case "status":
      return rows.map((row) =>
        row.id === change.id ? { ...row, status: change.status } : row,
      );
    case "move": {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return change.ids.flatMap((id) => byId.get(id) ?? []);
    }
  }
}

function sendSubtaskChange(change: SubtaskChange) {
  switch (change.kind) {
    case "status":
      return setTaskStatusFromDrag({
        taskId: change.id,
        desiredStatus: change.status,
        ...(change.comment ? { comment: change.comment } : {}),
      });
    case "move":
      return moveSubtask({
        taskId: change.id,
        afterTaskId: change.ids[change.ids.indexOf(change.id) - 1] ?? null,
      });
  }
}

interface UseTaskSubtasksOptions {
  parentTaskId: string;
  initialRows: SubtaskRow[];
  /** When the server read `initialRows`, in epoch milliseconds. */
  renderedAt: number;
  personalAssistantFallback: string;
  /** Core refused `change` or the request failed; the checklist is rolled back. */
  onError: (change: SubtaskChange) => void;
}

/**
 * A Task's sub-tasks, in order. Toggle and reorder show at once and roll
 * back when Core refuses; the list then reads Core again.
 */
export function useTaskSubtasks({
  parentTaskId,
  initialRows,
  renderedAt,
  personalAssistantFallback,
  onError,
}: UseTaskSubtasksOptions) {
  const queryClient = useQueryClient();
  const queryKey = taskSubtasksQueryKey(parentTaskId);
  const { data: rows } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await coreClient.getTasks({
        parentTaskId,
        limit: SUBTASK_LIST_LIMIT,
      });
      return result.data.map((task) =>
        toSubtaskRow(task, personalAssistantFallback),
      );
    },
    initialData: initialRows,
    initialDataUpdatedAt: renderedAt,
  });
  // The cache outlives the page. A refresh brings newer page rows; Back can
  // replay older ones, so only newer rows replace it. A change in flight
  // keeps its optimistic order.
  useEffect(() => {
    const key = taskSubtasksQueryKey(parentTaskId);
    const cachedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (
      renderedAt > cachedAt &&
      queryClient.isMutating({ mutationKey: key }) === 0
    )
      queryClient.setQueryData(key, initialRows, { updatedAt: renderedAt });
  }, [queryClient, parentTaskId, initialRows, renderedAt]);

  // Changes overlap: a quick second toggle starts before the first settles.
  const lastInFlight = () =>
    queryClient.isMutating({ mutationKey: queryKey }) <= 1;
  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: async (change: SubtaskChange) => {
      const result = await sendSubtaskChange(change);
      if (!result.ok) throw new Error("Sub-task change refused");
    },
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SubtaskRow[]>(queryKey) ?? [];
      queryClient.setQueryData(queryKey, applySubtaskChange(previous, change));
      return { previous };
    },
    onError: (_error, change, context) => {
      // The snapshot predates later changes still in flight; the reload after
      // the last one shows what Core holds instead.
      if (context && lastInFlight())
        queryClient.setQueryData(queryKey, context.previous);
      onError(change);
    },
    onSettled: () => {
      if (lastInFlight()) return queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    rows,
    setStatus: (id: string, status: TaskStatus, comment?: string) =>
      mutation.mutate({ kind: "status", id, status, comment }),
    move: (id: string, ids: string[]) =>
      mutation.mutate({ kind: "move", id, ids }),
  };
}
