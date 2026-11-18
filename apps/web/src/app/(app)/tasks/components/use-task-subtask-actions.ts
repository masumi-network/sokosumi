"use client";

import { ListPlus, ListTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MAX_SUBTASK_DEPTH } from "@/app/tasks/utils/task-subtask-row";
import { setTaskParent } from "@/lib/actions/task/subtask-action";
import type { TaskPickerTask } from "./task-detail-api-types";
import type { TaskPickerOption } from "./task-link-task-picker-dialog";
import {
  createSubtaskFromDraft,
  type NewSubtaskDraft,
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
 * or a tree too deep; its message is shown as it is.
 */
export function useTaskSubtaskActions({
  taskId,
  parentTaskId,
  ancestorIds,
  canManageRelations,
}: UseTaskSubtaskActionsOptions) {
  const t = useTranslations("App.Tasks.Detail.actions.subtasks");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pickerOption, setPickerOption] = useState<TaskPickerOption | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  // A new sub-task's level is this Task's chain length.
  const canAddSubtask =
    canManageRelations && ancestorIds.length < MAX_SUBTASK_DEPTH;
  const canRemoveFromParent = canManageRelations && parentTaskId !== null;

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
  // already is.
  const excludeTaskIds =
    pickerOption?.id === ADD_EXISTING_OPTION_ID
      ? ancestorIds
      : parentTaskId
        ? [parentTaskId]
        : [];

  function showRefusal(message: string | null | undefined) {
    toast.error(message || t("moveError"));
  }

  function move(
    input: { taskId: string; parentTaskId: string | null },
    successMessage: string,
  ) {
    startTransition(async () => {
      try {
        const result = await setTaskParent(input);
        if (!result.ok) {
          showRefusal(result.error.message);
          return;
        }
        toast.success(successMessage);
      } catch (error) {
        console.error("Failed to move task", error);
        showRefusal(null);
      }
    });
  }

  function handlePickTask(option: TaskPickerOption, picked: TaskPickerTask) {
    setPickerOption(null);
    if (option.id === ADD_EXISTING_OPTION_ID) {
      move(
        { taskId: picked.id, parentTaskId: taskId },
        t("addExistingSuccess"),
      );
    } else {
      move({ taskId, parentTaskId: picked.id }, t("moveUnderSuccess"));
    }
  }

  async function handleCreate(draft: NewSubtaskDraft): Promise<boolean> {
    try {
      const result = await createSubtaskFromDraft(taskId, draft);
      if (!result.ok) {
        toast.error(result.error.message || t("createError"));
        return false;
      }
      toast.success(t("createSuccess"));
      return true;
    } catch (error) {
      console.error("Failed to create sub-task", error);
      toast.error(t("createError"));
      return false;
    }
  }

  return {
    canAddSubtask,
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
    closePicker: () => setPickerOption(null),
    excludeTaskIds,
    handlePickTask,
    handleRemoveFromParent: () =>
      move({ taskId, parentTaskId: null }, t("removeFromParentSuccess")),
  };
}

export type TaskSubtaskActionsModel = ReturnType<typeof useTaskSubtaskActions>;
