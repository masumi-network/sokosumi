import type { Task } from "@sokosumi/core-client";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Box, Building2, Lock, Repeat, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { AssistantOrb } from "@/components/aurora-orb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { TaskStatus } from "@/lib/types/core-dto";

import {
  TaskMetadataStatusField,
  type TaskMetadataStatusFieldLabels,
} from "./task-metadata-status-field";
import { getTaskStatusMarker } from "./task-status-badge";

interface TaskMetadataLabels {
  privateBadge: string;
  status: string;
  statusLabels: Record<TaskStatus, string>;
  owner: string;
  organization: string;
  personalWorkspace: string;
  project: string;
  noProject: string;
  schedule: string;
  assignee: string;
  noAssignee: string;
  personalAssistantFallback: string;
}

interface TaskMetadataTask {
  status: Task["status"];
  visibility?: Task["visibility"];
  selectableStatuses: Task["selectableStatuses"];
  owner: Task["owner"];
  organization: Task["organization"];
  assignee: Task["assignee"];
}

interface PersonDisplay {
  name: string;
  image: string | null;
  avatarSeed?: string | null;
}

function resolveTaskAssigneeDisplay(
  assignee: NonNullable<Task["assignee"]>,
  personalAssistantFallback: string,
): PersonDisplay {
  if (assignee.type === "sokoBot") {
    const sokoBot = assignee.sokoBot;
    const claimed = sokoBot.avatarImageUrl
      ? resolveIpfsOrHttpUrl(sokoBot.avatarImageUrl)
      : null;
    return {
      name: sokoBot.name?.trim() || personalAssistantFallback,
      image: claimed,
      avatarSeed: claimed
        ? null
        : (sokoBot.avatarSeed ?? defaultOrbSeed(sokoBot.owner.id)),
    };
  }

  if (assignee.type === "user") {
    return {
      name: assignee.user.name.trim() || "Member",
      image: assignee.user.image
        ? resolveIpfsOrHttpUrl(assignee.user.image)
        : null,
    };
  }

  return {
    name: assignee.coworker.name,
    image: getCoworkerImage(assignee.coworker),
  };
}

interface TaskMetadataProps {
  title: string;
  taskId: string;
  task: TaskMetadataTask;
  project: { id: string; name: string } | null;
  /** Rendered in a Schedule row when the Task came from a Task Schedule. */
  schedule?: ReactNode;
  labels: TaskMetadataLabels;
  statusFieldLabels: TaskMetadataStatusFieldLabels;
  editable: boolean;
}

/**
 * Properties are label-free rows (icon or avatar + value, as in Linear); the
 * label lives in the accessible name and the hover tooltip.
 */
export function TaskMetadata({
  title,
  taskId,
  task,
  project,
  schedule,
  labels,
  statusFieldLabels,
  editable,
}: TaskMetadataProps) {
  const owner: PersonDisplay = {
    name: task.owner.name,
    image: task.owner.image ? resolveIpfsOrHttpUrl(task.owner.image) : null,
  };
  const assignee = task.assignee
    ? resolveTaskAssigneeDisplay(
        task.assignee,
        labels.personalAssistantFallback,
      )
    : null;
  const statusMarker = getTaskStatusMarker(task.status);
  const statusLabel = labels.statusLabels[task.status];
  const organizationName = task.organization?.name ?? labels.personalWorkspace;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      <div className="space-y-1">
        {editable ? (
          <TaskMetadataStatusField
            key={`${taskId}-${task.status}`}
            taskId={taskId}
            status={task.status}
            selectableStatuses={task.selectableStatuses}
            labels={statusFieldLabels}
          />
        ) : (
          <PropertyRow
            label={labels.status}
            value={statusLabel}
            icon={
              <StatusMarker
                spec={statusMarker}
                tone={getToneStyle(statusMarker.tone).labelOnSurface}
              />
            }
          >
            <span className="truncate">{statusLabel}</span>
          </PropertyRow>
        )}

        <PropertyRow
          label={labels.assignee}
          value={assignee?.name ?? labels.noAssignee}
          icon={
            assignee ? (
              <PersonAvatar person={assignee} />
            ) : (
              <UserRound className="text-muted-foreground size-4" />
            )
          }
        >
          {assignee ? (
            <span className="truncate">{assignee.name}</span>
          ) : (
            <span className="text-muted-foreground truncate">
              {labels.noAssignee}
            </span>
          )}
        </PropertyRow>

        <PropertyRow
          label={labels.owner}
          value={owner.name}
          icon={<PersonAvatar person={owner} />}
        >
          <span className="truncate">{owner.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {labels.owner}
          </span>
        </PropertyRow>

        <PropertyRow
          label={labels.organization}
          value={organizationName}
          icon={<Building2 className="text-muted-foreground size-4" />}
        >
          <span className="truncate">{organizationName}</span>
        </PropertyRow>

        <PropertyRow
          label={labels.project}
          value={project?.name ?? labels.noProject}
          icon={<Box className="text-muted-foreground size-4" />}
        >
          {project ? (
            <Link
              href={`/projects/${project.id}`}
              className="hover:text-primary truncate transition-colors"
            >
              {project.name}
            </Link>
          ) : (
            <span className="text-muted-foreground truncate">
              {labels.noProject}
            </span>
          )}
        </PropertyRow>

        {schedule ? (
          <PropertyRow
            label={labels.schedule}
            icon={<Repeat className="text-muted-foreground size-4" />}
          >
            {schedule}
          </PropertyRow>
        ) : null}

        {task.visibility === "PRIVATE" ? (
          <PropertyRow
            label={labels.privateBadge}
            icon={<Lock className="text-muted-foreground size-4" />}
          >
            <span className="truncate">{labels.privateBadge}</span>
          </PropertyRow>
        ) : null}
      </div>
    </section>
  );
}

interface PropertyRowProps {
  label: string;
  value?: string;
  /** Sits in a fixed slot so every row's text starts at the same x. */
  icon: ReactNode;
  children: ReactNode;
}

function PropertyRow({ label, value, icon, children }: PropertyRowProps) {
  const description = value ? `${label}: ${value}` : label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="group"
          aria-label={description}
          className="flex h-8 min-w-0 items-center gap-2 text-sm"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            {icon}
          </span>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">{description}</TooltipContent>
    </Tooltip>
  );
}

function PersonAvatar({ person }: { person: PersonDisplay }) {
  if (person.avatarSeed) {
    return (
      <AssistantOrb
        seed={person.avatarSeed}
        expression="idle"
        animate={false}
        size={20}
        className="size-5 shrink-0"
        alt={person.name}
      />
    );
  }

  return (
    <Avatar className="size-5">
      {person.image ? (
        <AvatarImage
          src={person.image}
          alt={person.name}
          className="object-cover"
        />
      ) : null}
      <AvatarFallback className="bg-muted text-[0.625rem]">
        {person.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
