"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { useTaskScheduleCopyProjects } from "@/hooks/effects/use-task-schedule-copy-projects";

/** First step of "Copy to another Project": choose where the copy goes. */
export function TaskScheduleCopyProjectPicker({
  currentProjectId,
  onSelect,
  onClose,
}: {
  currentProjectId: string | null;
  onSelect: (project: ProjectFilterOption) => void;
  onClose: () => void;
}) {
  const t = useTranslations("App.Tasks.Schedules.Actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const [search, setSearch] = useState("");

  const { query, projects, hasNext, isLoading, hasError, loadMore } =
    useTaskScheduleCopyProjects(currentProjectId, search);

  const status = hasError
    ? t("copyToProjectFailed")
    : isLoading && projects.length === 0
      ? t("copyToProjectLoading")
      : null;

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("copyToProjectTitle")}
      description={t("copyToProjectDescription")}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={tNewTask("projectSearchPlaceholder")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {status ? (
          <p
            role="status"
            className="text-muted-foreground px-4 py-6 text-center text-sm"
          >
            {status}
          </p>
        ) : projects.length === 0 ? (
          <CommandEmpty>
            {query ? tNewTask("projectEmptyResults") : t("copyToProjectNone")}
          </CommandEmpty>
        ) : null}
        {projects.length > 0 ? (
          <CommandGroup heading={t("copyToProjectTitle")}>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                onSelect={() =>
                  onSelect({
                    id: project.id,
                    name: project.name,
                    logo: project.logo,
                  })
                }
              >
                <ProjectAvatar
                  name={project.name}
                  logo={project.logo}
                  className="size-5 shrink-0"
                />
                <span className="truncate">{project.name}</span>
              </CommandItem>
            ))}
            {hasNext ? (
              <CommandItem
                value="load-more"
                disabled={isLoading}
                onSelect={loadMore}
              >
                {isLoading ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : null}
                <span>{t("copyToProjectLoadMore")}</span>
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
