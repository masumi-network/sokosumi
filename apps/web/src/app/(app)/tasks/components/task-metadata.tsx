import type { Task } from "@sokosumi/core-client";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import {
  Building2,
  CalendarClock,
  FolderKanban,
  Lock,
  Repeat,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { AssistantOrb } from "@/components/aurora-orb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { defaultSokoBotOrbSeed } from "@/lib/soko-bot-orb-seed";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { TaskDueBadge } from "./task-due-badge";
import { TaskMetadataDueField } from "./task-metadata-due-field";
import {
  TaskMetadataPriorityField,
  type TaskPriorityLabels,
} from "./task-metadata-priority-field";
import {
  TaskMetadataStatusField,
  type TaskMetadataStatusFieldLabels,
} from "./task-metadata-status-field";
import { TaskPriorityIcon } from "./task-priority-icon";
import { TaskRunAtBadge } from "./task-run-at-badge";
import { TaskStatusAge } from "./task-status-age";
import { getTaskStatusMarker } from "./task-status-badge";

interface TaskMetadataLabels {
  privateBadge: string;
  status: string;
  statusLabels: Record<TaskStatus, string>;
  organization: string;
  organizationReadOnly: string;
  personalWorkspace: string;
  project: string;
  noProject: string;
  schedule: string;
  startsAt: string;
  assignee: string;
  noAssignee: string;
  memberFallback: string;
  personalAssistantFallback: string;
}

interface TaskMetadataTask {
  status: Task["status"];
  priority: Task["priority"];
  dueOn: Task["dueOn"];
  visibility?: Task["visibility"];
  selectableStatuses: Task["selectableStatuses"];
  organization: Task["organization"];
  assignee: Task["assignee"];
  /** ISO start time; shown while the task waits for it (Scheduled). */
  runAt?: string | null;
  /** ISO time the Task took its status. */
  statusSince?: string;
}

interface PersonDisplay {
  name: string;
  image: string | null;
  avatarSeed?: string | null;
}

function resolveTaskAssigneeDisplay(
  assignee: NonNullable<Task["assignee"]>,
  personalAssistantFallback: string,
  memberFallback: string,
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
        : (sokoBot.avatarSeed ?? defaultSokoBotOrbSeed(sokoBot)),
    };
  }

  if (assignee.type === "user") {
    return {
      name: assignee.user.name.trim() || memberFallback,
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
  /** A row of its own (see {@link PropertyRow}): what the Task has cost. */
  credits?: ReactNode;
  /** A row of its own: the Task's participants, after the assignee. */
  participants?: ReactNode;
  /** Replaces the read-only Assignee row when the viewer may change it. */
  assigneeField?: ReactNode;
  /** Replaces the read-only Project row when the viewer may change it. */
  projectField?: ReactNode;
  labels: TaskMetadataLabels;
  statusFieldLabels: TaskMetadataStatusFieldLabels;
  priorityLabels: TaskPriorityLabels;
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
  credits,
  participants,
  assigneeField,
  projectField,
  labels,
  statusFieldLabels,
  priorityLabels,
  editable,
}: TaskMetadataProps) {
  const assignee = task.assignee
    ? resolveTaskAssigneeDisplay(
        task.assignee,
        labels.personalAssistantFallback,
        labels.memberFallback,
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
            statusSince={task.statusSince}
            agentAssigneeName={
              task.assignee?.type === "user" ? null : (assignee?.name ?? null)
            }
            labels={statusFieldLabels}
          />
        ) : (
          <>
            <PropertyRow
              label={labels.status}
              value={statusLabel}
              icon={
                <StatusMarker
                  spec={statusMarker}
                  tone={getToneStyle(statusMarker.tone).onSurface}
                />
              }
            >
              <span className="truncate">{statusLabel}</span>
            </PropertyRow>
            {task.statusSince ? (
              <TaskStatusAge
                status={task.status}
                statusSince={task.statusSince}
                variant="row"
              />
            ) : null}
          </>
        )}

        {task.status === "QUEUED" && task.runAt ? (
          <PropertyRow
            label={labels.startsAt}
            icon={<CalendarClock className="text-muted-foreground size-4" />}
          >
            <TaskRunAtBadge
              runAt={task.runAt}
              showIcon={false}
              className="text-foreground text-sm"
            />
          </PropertyRow>
        ) : null}

        {editable ? (
          <TaskMetadataPriorityField
            key={`${taskId}-${task.priority}`}
            taskId={taskId}
            priority={task.priority}
            labels={priorityLabels}
          />
        ) : (
          <PropertyRow
            label={priorityLabels.priority}
            value={priorityLabels.levels[task.priority]}
            icon={<TaskPriorityIcon priority={task.priority} />}
          >
            <span
              className={cn(
                "truncate",
                task.priority === "NONE" && "text-muted-foreground",
              )}
            >
              {priorityLabels.levels[task.priority]}
            </span>
          </PropertyRow>
        )}

        {editable ? (
          <TaskMetadataDueField
            key={`${taskId}-${task.dueOn}`}
            taskId={taskId}
            dueOn={task.dueOn}
            status={task.status}
          />
        ) : task.dueOn ? (
          <div className="flex h-8 items-center">
            <TaskDueBadge
              dueOn={task.dueOn}
              status={task.status}
              variant="row"
            />
          </div>
        ) : null}

        {/* Each slot gets its own key: callers key their fields by Task id
            to reset them on a new Task, and same-keyed siblings duplicated
            rows when the status changed. */}
        <Fragment key="assignee">
          {assigneeField ?? (
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
          )}
        </Fragment>

        <Fragment key="participants">{participants}</Fragment>

        <Fragment key="project">
          {projectField ?? (
            <PropertyRow
              label={labels.project}
              value={project?.name ?? labels.noProject}
              icon={<FolderKanban className="text-muted-foreground size-4" />}
            >
              {project ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="hover:text-foreground truncate transition-colors"
                >
                  {project.name}
                </Link>
              ) : (
                <span className="text-muted-foreground truncate">
                  {labels.noProject}
                </span>
              )}
            </PropertyRow>
          )}
        </Fragment>

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

        {/* Last and set apart: the workspace owns it, so it never edits here.
            The workspace's credits for this Task sit under its name. */}
        <div className="border-t pt-1">
          <PropertyRow
            label={labels.organization}
            value={`${organizationName} (${labels.organizationReadOnly})`}
            icon={<Building2 className="text-muted-foreground size-4" />}
          >
            <span className="text-muted-foreground truncate">
              {organizationName}
            </span>
            <Lock
              className="text-muted-foreground ml-auto size-3.5 shrink-0"
              aria-hidden
            />
          </PropertyRow>
          {credits}
        </div>
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

export function PropertyRow({
  label,
  value,
  icon,
  children,
}: PropertyRowProps) {
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
      <AvatarFallback className="bg-muted text-2xs">
        {person.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
