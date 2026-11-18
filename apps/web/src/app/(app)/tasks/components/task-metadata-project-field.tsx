"use client";

import { removeTaskContextAttachmentLinks } from "@sokosumi/utils";
import { ArrowUpRight, Check, FolderKanban } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setTaskProject } from "@/lib/actions/task/property-action";
import { cn } from "@/lib/utils";

import {
  canMoveTaskToProject,
  getTaskContextSelectionForProjectMove,
  toTaskContextSelectionInput,
} from "./task-context-attachments";
import { ROW_TRIGGER_CLASS } from "./task-status-picker";

const NO_PROJECT_VALUE = "__no_project__";

interface TaskMetadataProjectFieldProps {
  taskId: string;
  projectId: string | null;
  /** Includes the current project even when it is past the list limit. */
  options: ProjectFilterOption[];
  /** What the Context links in the description are read against. */
  context: {
    description: string;
    defaultBrandUrl: string | null;
    userId: string | null;
  };
  labels: { project: string; noProject: string };
}

export function TaskMetadataProjectField({
  taskId,
  projectId,
  options,
  context,
  labels,
}: TaskMetadataProjectFieldProps) {
  const t = useTranslations("App.Tasks.Detail.projectField");
  // Shows the pick until the action's revalidation lands, and falls back to
  // the server value by itself when the action fails.
  const [current, setCurrent] = useOptimistic(projectId);
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const [isPending, startTransition] = useTransition();

  const selected = options.find((project) => project.id === current) ?? null;
  const moveContext = {
    from: selected ?? undefined,
    defaultBrandUrl: context.defaultBrandUrl,
    userId: context.userId,
  };
  const canMoveTo = (project: ProjectFilterOption | undefined) =>
    canMoveTaskToProject(context.description, { ...moveContext, to: project });
  // Only a Task with no prose of its own can be blocked; skip the scan else.
  const hasProse = Boolean(
    removeTaskContextAttachmentLinks(context.description).trim(),
  );
  const blockedIds = new Set(
    hasProse
      ? []
      : [...options, undefined]
          .filter(
            (project) =>
              (project?.id ?? null) !== current && !canMoveTo(project),
          )
          .map((project) => project?.id ?? NO_PROJECT_VALUE),
  );
  const displayName = selected?.name ?? labels.noProject;
  const ariaLabel = `${labels.project}: ${displayName}`;

  function handleSelect(next: string | null) {
    setOpen(false);
    if (next === current) return;

    const selection = getTaskContextSelectionForProjectMove(
      context.description,
      { ...moveContext, to: options.find((project) => project.id === next) },
    );
    startTransition(async () => {
      setCurrent(next);
      try {
        const result = await setTaskProject({
          taskId,
          projectId: next,
          context: toTaskContextSelectionInput(selection),
        });
        if (!result.ok) {
          toast.error(t("updateError"));
        }
      } catch (error) {
        console.error("Failed to update task project", error);
        toast.error(t("updateError"));
      }
    });
  }

  return (
    <div className="group/project relative">
      <Popover open={open} onOpenChange={(next) => setOpen(next && !isPending)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                role="combobox"
                aria-expanded={open}
                aria-label={ariaLabel}
                aria-disabled={isPending || undefined}
                className={cn(
                  "focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed",
                  ROW_TRIGGER_CLASS,
                  selected && "pr-9",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {selected ? (
                    <ProjectAvatar
                      name={selected.name}
                      logo={selected.logo}
                      className="size-5 rounded-md"
                    />
                  ) : (
                    <FolderKanban
                      className="text-muted-foreground size-4"
                      aria-hidden
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "truncate",
                    !selected && "text-muted-foreground",
                  )}
                >
                  {displayName}
                </span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">{ariaLabel}</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-72 p-0">
          <Command className="**:data-[slot=command-list]:max-h-72">
            <CommandInput
              autoFocus
              hideIcon
              placeholder={t("change")}
              aria-describedby={blockedIds.size > 0 ? hintId : undefined}
            />
            <CommandList className="touch-pan-y p-1">
              <CommandEmpty>{t("noMatches")}</CommandEmpty>
              <CommandItem
                value={NO_PROJECT_VALUE}
                keywords={[labels.noProject]}
                disabled={blockedIds.has(NO_PROJECT_VALUE)}
                data-current={current === null || undefined}
                onSelect={() => handleSelect(null)}
              >
                <span className="flex size-5 items-center justify-center">
                  <FolderKanban
                    className="text-muted-foreground size-4"
                    aria-hidden
                  />
                </span>
                <span className="flex-1 truncate">{labels.noProject}</span>
                {current === null ? (
                  <Check className="size-4" aria-hidden />
                ) : null}
              </CommandItem>
              {options.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  keywords={[project.name]}
                  disabled={blockedIds.has(project.id)}
                  data-current={project.id === current || undefined}
                  onSelect={() => handleSelect(project.id)}
                >
                  <span aria-hidden>
                    <ProjectAvatar
                      name={project.name}
                      logo={project.logo}
                      className="size-5 shrink-0 rounded-md"
                    />
                  </span>
                  <span className="flex-1 truncate">{project.name}</span>
                  {project.id === current ? (
                    <Check className="size-4" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
          {blockedIds.size > 0 ? (
            <p
              id={hintId}
              className="text-muted-foreground border-t px-3 py-2 text-xs text-pretty"
            >
              {t("needsDescription")}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
      {selected ? (
        <Link
          href={`/projects/${selected.id}`}
          aria-label={t("open", { name: selected.name })}
          className="text-muted-foreground hover:text-foreground hover:bg-quaternary focus-visible:ring-ring focus-visible:inset-ring-ring absolute top-1/2 right-0 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:inset-ring-1 pointer-fine:opacity-0 pointer-fine:group-focus-within/project:opacity-100 pointer-fine:group-hover/project:opacity-100"
        >
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
