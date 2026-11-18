"use client";

import { ListChecks, SquareArrowRightExit } from "lucide-react";
import { useTranslations } from "next-intl";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskLinkTaskPickerDialog } from "./task-link-task-picker-dialog";
import { TaskSubtaskCreateDialog } from "./task-subtask-create-dialog";
import type { TaskSubtaskActionsModel } from "./use-task-subtask-actions";

/** The sub-task items of the Task header's "⋯" menu. */
export function TaskSubtaskMenuItems({
  model,
  disabled,
}: {
  model: TaskSubtaskActionsModel;
  disabled: boolean;
}) {
  const t = useTranslations("App.Tasks.Detail.actions.subtasks");
  const { addExistingOption, moveUnderOption } = model;

  return (
    <>
      {model.canAddSubtask ? (
        <>
          <DropdownMenuItem disabled={disabled} onSelect={model.openCreate}>
            <ListChecks className="size-4" aria-hidden />
            {t("add")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => model.openPicker(addExistingOption)}
          >
            <addExistingOption.icon className="size-4" aria-hidden />
            {addExistingOption.label}
          </DropdownMenuItem>
        </>
      ) : null}
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => model.openPicker(moveUnderOption)}
      >
        <moveUnderOption.icon className="size-4" aria-hidden />
        {moveUnderOption.label}
      </DropdownMenuItem>
      {model.canRemoveFromParent ? (
        <DropdownMenuItem
          disabled={disabled}
          onSelect={model.handleRemoveFromParent}
        >
          <SquareArrowRightExit className="size-4" aria-hidden />
          {t("removeFromParent")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** The dialogs the sub-task menu items open. */
export function TaskSubtaskMenuDialogs({
  model,
  taskId,
  assigneeOptions,
}: {
  model: TaskSubtaskActionsModel;
  taskId: string;
  assigneeOptions: CoworkerOption[];
}) {
  return (
    <>
      {model.isCreateOpen ? (
        <TaskSubtaskCreateDialog
          assigneeOptions={assigneeOptions}
          onSubmit={model.handleCreate}
          onClose={model.closeCreate}
        />
      ) : null}
      <TaskLinkTaskPickerDialog
        taskId={taskId}
        open={model.pickerOption !== null}
        onOpenChange={(open) => {
          if (!open) model.closePicker();
        }}
        selectedOption={model.pickerOption}
        isLinkPending={model.isPending}
        excludeTaskIds={model.excludeTaskIds}
        onSelectTask={model.handlePickTask}
      />
    </>
  );
}
