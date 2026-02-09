import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TaskWithCoworker } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";

import { TaskStatusBadge } from "./task-status-badge";

interface TaskMetadataLabels {
  propertiesTitle: string;
  status: string;
  coworker: string;
  created: string;
  updated: string;
}

interface TaskMetadataProps {
  task: TaskWithCoworker;
  labels: TaskMetadataLabels;
}

export function TaskMetadata({ task, labels }: TaskMetadataProps) {
  const coworkerImage = getCoworkerImage(task.coworker);

  return (
    <div className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {labels.propertiesTitle}
      </h3>

      <div className="space-y-3">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">{labels.status}</span>
          <TaskStatusBadge status={task.status} showLabel />
        </div>

        {/* Coworker */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.coworker}
          </span>
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              {coworkerImage ? (
                <AvatarImage
                  src={coworkerImage}
                  alt={task.coworker?.name ?? "Coworker"}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-muted text-[10px]">
                {task.coworker?.name?.slice(0, 1).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">
              {task.coworker?.name ?? "—"}
            </span>
          </div>
        </div>

        <div className="border-border/50 my-3 border-t" />

        {/* Created */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.created}
          </span>
          <span className="text-muted-foreground text-sm tabular-nums">
            {formatShortDate(task.createdAt)}
          </span>
        </div>

        {/* Updated */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.updated}
          </span>
          <span className="text-muted-foreground text-sm tabular-nums">
            {formatShortDate(task.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
