import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import Link from "next/link";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { TaskScheduleDisplay } from "@/components/task-schedule-display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import type { TaskStatus } from "@/lib/types/core-dto";

import { TaskStatusBadge } from "./task-status-badge";

interface TaskMetadataLabels {
  propertiesTitle: string;
  status: string;
  statusLabels: Record<TaskStatus, string>;
  pendingApproval: string;
  owner: string;
  organization: string;
  personalWorkspace: string;
  project: string;
  coworker: string;
  created: string;
  updated: string;
  schedule: string;
}

interface TaskMetadataTask {
  status: Task["status"];
  pendingApproval?: boolean;
  user: Task["user"];
  organization: Task["organization"];
  coworker: Task["coworker"];
  metadata?: string | null;
  nextRunAt?: Date | null;
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
  const ownerImage = task.user.image
    ? resolveIpfsOrHttpUrl(task.user.image)
    : null;
  const coworkerImage = getCoworkerImage(task.coworker);

  return (
    <div className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {labels.propertiesTitle}
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">{labels.status}</span>
          <div className="flex items-center gap-2">
            {task.pendingApproval ? (
              <Badge variant="secondary">{labels.pendingApproval}</Badge>
            ) : null}
            <TaskStatusBadge
              status={task.status}
              label={labels.statusLabels[task.status]}
              showLabel
            />
          </div>
        </div>

        <MetadataAvatarValue
          label={labels.owner}
          name={task.user.name}
          image={ownerImage}
          fallback={task.user.name}
        />

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
            <span className="truncate text-right text-sm font-medium">
              {task.coworker?.name ?? "—"}
            </span>
          </div>
        </div>

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
            {fallback.slice(0, 1).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-right text-sm font-medium">{name}</span>
      </div>
    </div>
  );
}
