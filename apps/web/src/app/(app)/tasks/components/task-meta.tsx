"use client";

import { Calendar, MessageSquare } from "lucide-react";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import type {
  TaskAssigneeView,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProjectSummary } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

const MAX_CLUSTER_FACES = 3;

interface TaskMetaDetailsProps {
  project: TaskWithCoworker["project"];
  assignee: TaskWithCoworker["assignee"];
  participants: TaskWithCoworker["participants"];
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

/**
 * The assignee leads, then participants in join order. A human assignee who
 * was also mentioned is one face. Owner is never added here.
 */
function collectTaskActors(
  assignee: TaskWithCoworker["assignee"],
  participants: TaskWithCoworker["participants"],
): TaskAssigneeView[] {
  const seen = new Set<string>();
  const actors: TaskAssigneeView[] = [];
  for (const actor of [assignee, ...participants]) {
    if (!actor) continue;
    const key = `${actor.kind}:${actor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actors.push(actor);
  }
  return actors;
}

function TaskActorCluster({
  assignee,
  participants,
}: Pick<TaskMetaDetailsProps, "assignee" | "participants">) {
  const actors = collectTaskActors(assignee, participants);
  const faces = actors.slice(0, MAX_CLUSTER_FACES);
  const remainder = actors.length - faces.length;
  const names =
    actors.map((actor) => actor.name?.trim() || "—").join(", ") || "—";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 items-center"
          role="img"
          aria-label={names}
        >
          {faces.length === 0 ? <AssigneeAvatar assignee={null} /> : null}
          {faces.map((actor, index) => (
            <span
              key={`${actor.kind}:${actor.id}`}
              data-testid="task-actor-face"
              className={cn(
                "ring-background relative inline-flex rounded-full ring-2",
                index > 0 && "-ml-1.5",
              )}
              style={{ zIndex: faces.length - index }}
            >
              <AssigneeAvatar assignee={actor} />
            </span>
          ))}
          {remainder > 0 ? (
            <span
              className="bg-muted text-muted-foreground ring-background relative -ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.625rem] font-medium tabular-nums ring-2"
              style={{ zIndex: faces.length + 1 }}
            >
              +{remainder}
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {names}
      </TooltipContent>
    </Tooltip>
  );
}

export function TaskMetaDetails({
  project,
  assignee,
  participants,
  commentsCount,
  createdAt,
  variant = "card",
}: TaskMetaDetailsProps) {
  const { formatShortDate } = useLocalizedDateTime();

  if (variant === "list") {
    return (
      <>
        {project ? <TaskProjectMark project={project} /> : null}
        <TaskActorCluster assignee={assignee} participants={participants} />
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
        <TaskActorCluster assignee={assignee} participants={participants} />
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
