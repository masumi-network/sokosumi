import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import Link from "next/link";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { TaskScheduleDisplay } from "@/components/task-schedule-display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import type { TaskStatus } from "@/lib/types/core-dto";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import { TaskStatusBadge } from "./task-status-badge";

interface TaskMetadataLabels {
  propertiesTitle: string;
  status: string;
  statusLabels: Record<TaskStatus, string>;
  owner: string;
  creator: string;
  organization: string;
  personalWorkspace: string;
  project: string;
  coworker: string;
  credits: string;
  created: string;
  updated: string;
  schedule: string;
}

interface TaskMetadataTask {
  status: Task["status"];
  owner: Task["owner"];
  organization: Task["organization"];
  assignee: Task["assignee"];
  creator: Task["creator"];
  credits: Task["credits"];
  metadata?: string | null;
  nextRunAt?: Date | null;
}

interface TaskCreatorDisplay {
  name: string;
  image: string | null;
}

function resolveTaskCreatorDisplay(
  task: TaskMetadataTask,
): TaskCreatorDisplay | null {
  switch (task.creator.type) {
    case "user": {
      if (task.creator.id === task.owner.id) {
        return null;
      }

      return {
        name: task.creator.user.name,
        image: task.creator.user.image
          ? resolveIpfsOrHttpUrl(task.creator.user.image)
          : null,
      };
    }
    case "coworker": {
      // Generated CoworkerSummary is `| null` because assignee uses the same
      // named schema as nullable; creator.coworker is always present at runtime.
      const coworker = task.creator.coworker;
      if (!coworker) {
        return null;
      }

      return {
        name: coworker.name,
        image: getCoworkerImage(coworker),
      };
    }
    case "orchestrator": {
      const orchestrator = task.creator.orchestrator;
      if (!orchestrator) {
        return null;
      }

      return {
        name: orchestrator.name ?? "Assistant",
        image: null,
      };
    }
    default: {
      const _exhaustive: never = task.creator;
      return _exhaustive;
    }
  }
}

interface TaskMetadataProps {
  task: TaskMetadataTask;
  project: { id: string; name: string } | null;
  labels: TaskMetadataLabels;
  createdAtLabel: string;
  updatedAtLabel: string;
}

export function TaskMetadata({
  task,
  project,
  labels,
  createdAtLabel,
  updatedAtLabel,
}: TaskMetadataProps) {
  const ownerImage = task.owner.image
    ? resolveIpfsOrHttpUrl(task.owner.image)
    : null;
  const assigneeImage = getCoworkerImage(task.assignee);
  const creator = resolveTaskCreatorDisplay(task);

  return (
    <div className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {labels.propertiesTitle}
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">{labels.status}</span>
          <TaskStatusBadge
            status={task.status}
            label={labels.statusLabels[task.status]}
            showLabel
          />
        </div>

        <MetadataAvatarValue
          label={labels.owner}
          name={task.owner.name}
          image={ownerImage}
          fallback={task.owner.name}
        />

        {creator ? (
          <MetadataAvatarValue
            label={labels.creator}
            name={creator.name}
            image={creator.image}
            fallback={creator.name}
          />
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">
            {labels.organization}
          </span>
          <span className="text-right text-sm font-medium">
            {task.organization?.name ?? labels.personalWorkspace}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">
            {labels.project}
          </span>
          {project ? (
            <Link
              href={`/projects/${project.id}`}
              className="hover:text-primary truncate text-right text-sm font-medium transition-colors"
            >
              {project.name}
            </Link>
          ) : (
            <span className="text-right text-sm font-medium">—</span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.coworker}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-5">
              {assigneeImage ? (
                <AvatarImage
                  src={assigneeImage}
                  alt={task.assignee?.name ?? "Coworker"}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-muted text-[10px]">
                {task.assignee?.name?.slice(0, 1).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-right text-sm font-medium">
              {task.assignee?.name ?? "—"}
            </span>
          </div>
        </div>

        {task.credits > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-sm">
              {labels.credits}
            </span>
            <span className="text-right text-sm font-medium tabular-nums">
              {formatCreditsForDisplay(task.credits)}
            </span>
          </div>
        ) : null}

        {task.metadata || task.nextRunAt ? (
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground text-sm">
              {labels.schedule}
            </span>
            <TaskScheduleDisplay
              className="text-right"
              metadata={task.metadata}
              nextRunAt={task.nextRunAt ?? null}
            />
          </div>
        ) : null}

        <div className="border-border/50 my-3 border-t" />

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.created}
          </span>
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {createdAtLabel}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {labels.updated}
          </span>
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {updatedAtLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

interface MetadataAvatarValueProps {
  label: string;
  name: string;
  image: string | null;
  fallback: string;
}

function MetadataAvatarValue({
  label,
  name,
  image,
  fallback,
}: MetadataAvatarValueProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="size-5">
          {image ? (
            <AvatarImage src={image} alt={name} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-muted text-[10px]">
            {fallback.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-right text-sm font-medium">{name}</span>
      </div>
    </div>
  );
}
