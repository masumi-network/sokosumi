import { BackToTasksButton } from "./back-to-tasks-button";

interface TaskDetailHeaderProps {
  taskName: string;
  backLabel: string;
  actions?: React.ReactNode;
}

export function TaskDetailHeader({
  taskName,
  backLabel,
  actions,
}: TaskDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackToTasksButton label={backLabel} />

        {actions}
      </div>

      <h1 className="text-xl leading-tight font-semibold tracking-tight">
        {taskName}
      </h1>
    </div>
  );
}
