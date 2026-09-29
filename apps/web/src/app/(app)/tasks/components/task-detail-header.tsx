import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

import { BackToTasksButton } from "./back-to-tasks-button";
import { TaskIdentifierCopy } from "./task-identifier-copy";

interface TaskDetailHeaderProps {
  taskName: string;
  /** Short id such as SOK-12; hidden for tasks without a project. */
  identifier?: string | null;
  identifierLabels?: {
    copy: string;
    copied: string;
    copyError: string;
  };
  backLabel: string;
  parentLink?: React.ReactNode;
  actions?: React.ReactNode;
}

export function TaskDetailHeader({
  taskName,
  identifier,
  identifierLabels,
  backLabel,
  parentLink,
  actions,
}: TaskDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end md:justify-between">
        <BackToTasksButton label={backLabel} />

        {actions}
      </div>

      <div className="space-y-1">
        {identifier && identifierLabels ? (
          <TaskIdentifierCopy
            identifier={identifier}
            copyLabel={identifierLabels.copy}
            copiedMessage={identifierLabels.copied}
            copyErrorMessage={identifierLabels.copyError}
          />
        ) : null}
        <h1 className="text-xl leading-tight font-semibold tracking-tight">
          {stripInlineMarkdown(taskName)}
        </h1>
      </div>
      {parentLink}
    </div>
  );
}
