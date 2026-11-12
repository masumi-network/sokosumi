"use client";

import { useTranslations } from "next-intl";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** Where a schedule may be copied: open, non-CMO Projects other than its own. */
export function copyDestinationProjects(
  projectOptions: ProjectFilterOption[],
  currentProjectId: string | null,
): ProjectFilterOption[] {
  return projectOptions.filter(
    (project) =>
      project.id !== currentProjectId && !project.cmo && !project.closed,
  );
}

/** First step of "Copy to another Project": choose where the copy goes. */
export function TaskScheduleCopyProjectPicker({
  projectOptions,
  currentProjectId,
  onSelect,
  onClose,
}: {
  projectOptions: ProjectFilterOption[];
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const destinations = copyDestinationProjects(
    projectOptions,
    currentProjectId,
  );

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("copyToProjectTitle")}
      description={t("copyToProjectDescription")}
    >
      {destinations.length > 0 ? (
        <CommandInput placeholder={tNewTask("projectSearchPlaceholder")} />
      ) : null}
      <CommandList>
        {destinations.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t("copyToProjectNone")}
          </p>
        ) : (
          <>
            <CommandEmpty>{tNewTask("projectEmptyResults")}</CommandEmpty>
            <CommandGroup heading={t("copyToProjectTitle")}>
              {destinations.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name} ${project.id}`}
                  onSelect={() => onSelect(project.id)}
                >
                  <ProjectAvatar
                    name={project.name}
                    logo={project.logo}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate">{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
