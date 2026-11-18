"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ListPlus, ListTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  MAX_SUBTASK_DEPTH,
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { setTaskParent } from "@/lib/actions/task/subtask-action";
import type { TaskPickerTask } from "./task-detail-api-types";
import type { TaskPickerOption } from "./task-link-task-picker-dialog";
import {
  invalidateSubtaskLists,
  refusalDescription,
  taskSubtasksQueryKey,
  useCreateSubtask,
} from "./use-task-subtasks";

const ADD_EXISTING_OPTION_ID = "add-existing-subtask";
const MOVE_UNDER_OPTION_ID = "move-under";

interface UseTaskSubtaskActionsOptions {
  taskId: string;
  /** The Task's parent, when it is a sub-task. */
  parentTaskId: string | null;
  /** The Task's parent chain, root first. */
  ancestorIds: readonly string[];
  canManageRelations: boolean;
}

/**
 * The header menu's sub-task actions: add a new sub-task, adopt an existing
 * Task, move this Task under another one, or detach it. Core refuses a cycle
 * or a tree too deep; its message is the toast's description.
 */
export function useTaskSubtaskActions({
  taskId,
  parentTaskId,
  ancestorIds,
  canManageRelations,
}: UseTaskSubtaskActionsOptions) {
  const t = useTranslations("App.Tasks.Detail.actions.subtasks");
  const queryClient = useQueryClient();
  const handleCreate = useCreateSubtask(taskId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pickerOption, setPickerOption] = useState<TaskPickerOption | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  // A new sub-task's level is this Task's chain length.
  const canAddSubtask =
    canManageRelations && ancestorIds.length < MAX_SUBTASK_DEPTH;
  const canRemoveFromParent = canManageRelations && parentTaskId !== null;
  // The checklist's rows, when it has read them. Read on each render, which
  // opening the menu causes.
  const childRows =
    queryClient.getQueryData<SubtaskRow[]>(taskSubtasksQueryKey(taskId)) ?? [];
  const childIds = childRows.map((row) => row.id);
  // Past the checklist's first page a new sub-task would land out of sight,
  // so the checklist's "+" is gone too.
  const canCreateSubtask =
    canAddSubtask && childRows.length < SUBTASK_LIST_LIMIT;

  const addExistingOption: TaskPickerOption = {
    id: ADD_EXISTING_OPTION_ID,
    label: t("addExisting"),
    title: t("addExistingTitle"),
    description: t("addExistingDescription"),
    icon: ListPlus,
    includeSubtasks: true,
  };
  const moveUnderOption: TaskPickerOption = {
    id: MOVE_UNDER_OPTION_ID,
    label: t("moveUnder"),
    title: t("moveUnderTitle"),
    description: t("moveUnderDescription"),
    icon: ListTree,
    includeSubtasks: true,
  };

  // An ancestor under this Task would be a cycle; under its own parent it
  // already is. A sub-task is already under this Task, and this Task under
  // its own sub-task is a cycle. Core still refuses deeper descendants.
  const excludeTaskIds =
    pickerOption?.id === ADD_EXISTING_OPTION_ID
      ? [...ancestorIds, ...childIds]
      : parentTaskId
        ? [parentTaskId, ...childIds]
        : childIds;

  /**
   * Sets a Task's parent. The picker stays open until Core answers: it closes
   * on success, so focus returns to the menu button once it is enabled again.
   */
  function move(
    input: { taskId: string; parentTaskId: string | null },
    successMessage: string,
    oldParentTaskId: string | null,
  ) {
    startTransition(async () => {
      try {
        const result = await setTaskParent(input);
        if (!result.ok) {
          toast.error(t("moveError"), {
            description: refusalDescription(result.error),
          });
          return;
        }
        invalidateSubtaskLists(queryClient, taskId, [
          input.parentTaskId,
          oldParentTaskId,
        ]);
        toast.success(successMessage);
        // In a transition, the close commits with the end of the pending state.
        startTransition(() => setPickerOption(null));
      } catch (error) {
        console.error("Failed to move task", error);
        toast.error(t("moveError"));
      }
    });
  }

  function handlePickTask(option: TaskPickerOption, picked: TaskPickerTask) {
    if (option.id === ADD_EXISTING_OPTION_ID) {
      move(
        { taskId: picked.id, parentTaskId: taskId },
        t("addExistingSuccess"),
        picked.parentTaskId,
      );
    } else {
      move(
        { taskId, parentTaskId: picked.id },
        t("moveUnderSuccess"),
        parentTaskId,
      );
    }
  }

  return {
    canAddSubtask,
    canCreateSubtask,
    canRemoveFromParent,
    isPending,
    isCreateOpen,
    openCreate: () => setIsCreateOpen(true),
    closeCreate: () => setIsCreateOpen(false),
    handleCreate,
    addExistingOption,
    moveUnderOption,
    pickerOption,
    openPicker: setPickerOption,
    // A move in flight keeps the picker open until Core answers.
    closePicker: () => {
      if (!isPending) setPickerOption(null);
    },
    excludeTaskIds,
    handlePickTask,
    handleRemoveFromParent: () =>
      move(
        { taskId, parentTaskId: null },
        t("removeFromParentSuccess"),
        parentTaskId,
      ),
  };
}

export type TaskSubtaskActionsModel = ReturnType<typeof useTaskSubtaskActions>;
