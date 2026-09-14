import { Badge } from "@/components/ui/badge";
import { BackToTasksButton } from "./back-to-tasks-button";

interface TaskDetailHeaderProps {
  taskName: string;
  backLabel: string;
  parentLink?: React.ReactNode;
  actions?: React.ReactNode;
  privateLabel?: string | null;
}

export function TaskDetailHeader({
  taskName,
  backLabel,
  parentLink,
  actions,
  privateLabel = null,
}: TaskDetailHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end md:justify-between">
        <BackToTasksButton label={backLabel} />

        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl leading-tight font-semibold tracking-tight">
          {taskName}
        </h1>
        {privateLabel ? (
          <Badge variant="secondary">{privateLabel}</Badge>
        ) : null}
      </div>
      {parentLink}
    </div>
  );
}
