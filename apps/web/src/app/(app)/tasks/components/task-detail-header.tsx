import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

import { BackToTasksButton } from "./back-to-tasks-button";
import { TaskIdentifierCopy } from "./task-identifier-copy";
import { TaskTitleHeading } from "./task-title-heading";

interface TaskDetailHeaderProps {
  taskId: string;
  taskName: string;
  /** Short id such as SOK-12; hidden for tasks without a project. */
  identifier?: string | null;
  identifierLabels?: {
    copy: string;
    copied: string;
    copyError: string;
  };
  backLabel: string;
  /** Back label when the task was opened from the Calendar. */
  calendarBackLabel?: string;
  /** False where the board is not the likely next page. */
  loadBoardOnMount?: boolean;
  parentLink?: React.ReactNode;
  actions?: React.ReactNode;
}

export function TaskDetailHeader({
  taskId,
  taskName,
  identifier,
  identifierLabels,
  backLabel,
  calendarBackLabel,
  loadBoardOnMount,
  parentLink,
  actions,
}: TaskDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end md:justify-between">
        <BackToTasksButton
          label={backLabel}
          calendarLabel={calendarBackLabel}
          loadOnMount={loadBoardOnMount}
        />

        {actions}
      </div>

      <div className="space-y-1">
        {identifier && identifierLabels ? (
          <TaskIdentifierCopy
            identifier={identifier}
            copyAriaLabelPrefix={identifierLabels.copy}
            copiedMessage={identifierLabels.copied}
            copyErrorMessage={identifierLabels.copyError}
          />
        ) : null}
        <TaskTitleHeading
          taskId={taskId}
          title={stripInlineMarkdown(taskName)}
        />
      </div>
      {parentLink}
    </div>
  );
}
