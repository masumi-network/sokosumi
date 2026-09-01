import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import Link from "next/link";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { resolveTaskAssigneeDisplay } from "@/app/tasks/utils/resolve-task-assignee";
import { AssistantOrb } from "@/components/aurora-orb";
import { TaskScheduleDisplay } from "@/components/task-schedule-display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { defaultOrbSeed } from "@/lib/aurora-orb";
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
  formatOrchestratorRole: (values: { owner: string }) => string;
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
  avatarSeed?: string | null;
  /** Under the name: what this creator is, when it is not a person. */
  role?: string | null;
}

function resolveTaskCreatorDisplay(
  task: TaskMetadataTask,
  formatOrchestratorRole: TaskMetadataLabels["formatOrchestratorRole"],
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

      // The assistant's own name reads as a person's here, so the line
      // underneath says what it is and who it belongs to. Without it a Task
      // created by "Jarvis" gives the reader no way to tell that a colleague's
      // assistant did it, or on whose behalf.
      const assistantName = orchestrator.name ?? "Assistant";
      const role = formatOrchestratorRole({ owner: orchestrator.owner.name });
      // A claimed mascot is the bot's face everywhere else, so the orb is the
      // fallback, not the rule. Claiming writes the coworker's image too,
      // which is why chat showed the picture and this showed a blank disc.
      const claimed = orchestrator.avatarImageUrl
        ? resolveIpfsOrHttpUrl(orchestrator.avatarImageUrl)
        : null;
      return {
        name: assistantName,
        // A bot named "Ada's personal assistant" would otherwise print the
        // same sentence twice.
        role: role.toLowerCase() === assistantName.toLowerCase() ? null : role,
        image: claimed,
        // Same fallback the sidebar and the Soko Bots page use. `avatarSeed`
        // is null for every bot, and passing that through rendered a different
        // face here than the one the owner sees everywhere else.
        avatarSeed: claimed
          ? null
          : (orchestrator.avatarSeed ?? defaultOrbSeed(orchestrator.owner.id)),
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
  const assigneeDisplay = resolveTaskAssigneeDisplay(task.assignee);
  const assigneeImage = assigneeDisplay.image;
  const creator = resolveTaskCreatorDisplay(
    task,
    labels.formatOrchestratorRole,
  );

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
            avatarSeed={creator.avatarSeed}
            role={creator.role}
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
            {assigneeDisplay.avatarSeed ? (
              <AssistantOrb
                seed={assigneeDisplay.avatarSeed}
                expression="idle"
                animate={false}
                size={20}
                className="size-5 shrink-0"
                alt={assigneeDisplay.name ?? "Assistant"}
              />
            ) : (
              <Avatar className="size-5">
                {assigneeImage ? (
                  <AvatarImage
                    src={assigneeImage}
                    alt={assigneeDisplay.name ?? "Coworker"}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-muted text-[0.625rem]">
                  {assigneeDisplay.name?.slice(0, 1).toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="truncate text-right text-sm font-medium">
              {assigneeDisplay.name ?? "—"}
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
  avatarSeed?: string | null;
  role?: string | null;
}

function MetadataAvatarValue({
  label,
  name,
  image,
  fallback,
  avatarSeed,
  role,
}: MetadataAvatarValueProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {avatarSeed ? (
          <AssistantOrb
            seed={avatarSeed}
            // Resting eyes so the creator chip reads as the assistant's
            // face, not a blank disc.
            expression="idle"
            animate={false}
            size={20}
            className="size-5 shrink-0"
            alt={name}
          />
        ) : (
          <Avatar className="size-5">
            {image ? (
              <AvatarImage src={image} alt={name} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-muted text-[0.625rem]">
              {fallback.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 text-right">
          <span className="block truncate text-sm font-medium">{name}</span>
          {role ? (
            <span className="text-muted-foreground block truncate text-xs">
              {role}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
