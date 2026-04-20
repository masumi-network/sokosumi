import { BackToTasksButton } from "./back-to-tasks-button";
import { NextTaskButton } from "./next-task-button";

interface TaskDetailHeaderProps {
  taskName: string;
  backLabel: string;
  nextLabel: string;
  currentTaskId: string;
  actions?: React.ReactNode;
}

export function TaskDetailHeader({
  taskName,
  backLabel,
  nextLabel,
  currentTaskId,
  actions,
}: TaskDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BackToTasksButton label={backLabel} />
          <NextTaskButton currentTaskId={currentTaskId} label={nextLabel} />
        </div>

        {actions}
      </div>

      <h1 className="text-xl leading-tight font-semibold tracking-tight">
        {taskName}
      </h1>
    </div>
  );
}
