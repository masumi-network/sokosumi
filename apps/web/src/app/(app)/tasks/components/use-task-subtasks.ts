"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
  toSubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { createSubtask, moveSubtask } from "@/lib/actions/task/subtask-action";
import { coreClient } from "@/lib/clients/core.browser.client";

export function taskSubtasksQueryKey(parentTaskId: string) {
  return ["task-subtasks", parentTaskId] as const;
}

export type SubtaskChange =
  | { kind: "status"; id: string; status: TaskStatus; comment?: string }
  | { kind: "move"; id: string; ids: string[] }
  | { kind: "add"; tempId: string; name: string };

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
    case "add":
      return [
        ...rows,
        {
          id: change.tempId,
          identifier: null,
          name: change.name,
          status: TaskStatus.READY,
          assignee: null,
          dueOn: null,
          subtaskProgress: { completed: 0, total: 0 },
          isPending: true,
        },
      ];
  }
}

function sendSubtaskChange(parentTaskId: string, change: SubtaskChange) {
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
    case "add":
      return createSubtask({ parentTaskId, name: change.name });
  }
}

interface UseTaskSubtasksOptions {
  parentTaskId: string;
  initialRows: SubtaskRow[];
  personalAssistantFallback: string;
  /** Core refused `change` or the request failed; the checklist is rolled back. */
  onError: (change: SubtaskChange) => void;
}

/**
 * A Task's sub-tasks, in order. Toggle, reorder and add show at once and roll
 * back when Core refuses; the list then reads Core again.
 */
export function useTaskSubtasks({
  parentTaskId,
  initialRows,
  personalAssistantFallback,
  onError,
}: UseTaskSubtasksOptions) {
  const queryClient = useQueryClient();
  const queryKey = taskSubtasksQueryKey(parentTaskId);
  // A cached list outlives the page, and a sub-task can change on its own
  // page meanwhile. Back can replay older page rows, so Core answers instead.
  const [cachedAtMount] = useState(
    () => queryClient.getQueryData(queryKey) !== undefined,
  );
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
    refetchOnMount: cachedAtMount ? "always" : true,
  });

  // Changes overlap: a quick second toggle starts before the first settles.
  const lastInFlight = () =>
    queryClient.isMutating({ mutationKey: queryKey }) <= 1;
  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: async (change: SubtaskChange) => {
      const result = await sendSubtaskChange(parentTaskId, change);
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
    add: (name: string) =>
      mutation.mutate({ kind: "add", tempId: crypto.randomUUID(), name }),
  };
}
