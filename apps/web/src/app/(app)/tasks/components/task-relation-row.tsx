import { TaskStatus } from "@sokosumi/database";
import Link from "next/link";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TaskLinkRelation } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";

interface TaskRelationRowProps {
  taskId: string;
  taskName: string;
  taskStatus: TaskStatus;
  relation: TaskLinkRelation;
  relationLabel?: string;
  relationTone?: "default" | "destructive";
}

export function TaskRelationRow({
  taskId,
  taskName,
  taskStatus,
  relation,
  relationLabel,
  relationTone = "default",
}: TaskRelationRowProps) {
  const RelationIcon = getTaskLinkRelationIcon(relation);

  return (
    <Link
      href={`/tasks/${taskId}`}
      className="bg-muted/40 border-border/50 hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2">
        {relationLabel ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <RelationIcon
                className={cn(
                  "size-4",
                  relationTone === "destructive" ? "text-destructive" : "",
                )}
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {relationLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <p className="truncate text-sm">{taskName}</p>
      </div>
      <TaskStatusBadge status={taskStatus} className="shrink-0" />
    </Link>
  );
}
