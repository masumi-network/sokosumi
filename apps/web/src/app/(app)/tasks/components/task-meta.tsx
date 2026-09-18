"use client";

import { Calendar, MessageSquare } from "lucide-react";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProjectSummary } from "@/lib/clients/generated/core/types.gen";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface TaskMetaDetailsProps {
  project: TaskWithCoworker["project"];
  assignee: TaskWithCoworker["assignee"];
  commentsCount: TaskWithCoworker["commentsCount"];
  createdAt: TaskWithCoworker["createdAt"];
  variant?: "card" | "list";
}

function TaskProjectMark({ project }: { project: ProjectSummary }) {
  const label = project.name.trim() || "—";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0" role="img" aria-label={label}>
          <ProjectAvatar
            name={project.name}
            logo={project.logo}
            className="size-5 rounded-lg"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function TaskMetaDetails({
  project,
  assignee,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  const { formatShortDate } = useLocalizedDateTime();
  const assigneeName = assignee?.name?.trim() || "—";

  if (variant === "list") {
    return (
      <>
        {project ? <TaskProjectMark project={project} /> : null}
        <div className="text-muted-foreground xs:w-auto flex w-24 items-center gap-1.5 truncate text-xs">
          <AssigneeAvatar assignee={assignee} />
          <span className="truncate">{assignee?.name ?? "—"}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <MessageSquare className="size-3.5" aria-hidden />
          <span>{commentsCount}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Calendar className="size-3" aria-hidden />
          <span className="whitespace-nowrap">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="border-border flex items-center justify-between gap-2 border-t pt-2">
      <div className="flex items-center gap-1.5">
        {project ? <TaskProjectMark project={project} /> : null}
        {assignee ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex shrink-0"
                role="img"
                aria-label={assigneeName}
              >
                <AssigneeAvatar assignee={assignee} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {assigneeName}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="text-muted-foreground flex items-center gap-2">
        {commentsCount > 0 && (
          <div className="flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            <span className="text-[0.625rem] tabular-nums">
              {commentsCount}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="size-3" aria-hidden />
          <span className="text-[0.625rem] tabular-nums">
            {formatShortDate(createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
