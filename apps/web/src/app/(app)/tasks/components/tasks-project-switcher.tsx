"use client";

import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import {
  applyProjectIdSearchParam,
  type ProjectFilterOption,
} from "@/app/tasks/utils/tasks-filters";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Project } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

const ALL_PROJECTS_VALUE = "__all_projects__";
const CREATE_PROJECT_VALUE = "__create_project__";

interface TasksProjectSwitcherProps {
  projectOptions: ProjectFilterOption[];
  selectedProjectId: string | null;
  onProjectCreated: (project: ProjectFilterOption) => void;
}

export function TasksProjectSwitcher({
  projectOptions,
  selectedProjectId,
  onProjectCreated,
}: TasksProjectSwitcherProps) {
  const t = useTranslations("App.Tasks.ProjectSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedProject = useMemo(
    () =>
      projectOptions.find((project) => project.id === selectedProjectId) ??
      null,
    [projectOptions, selectedProjectId],
  );
  const isProjectScoped = selectedProjectId !== null;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
    }
  }

  function applyProjectId(projectId: string | null) {
    const paramsForMerge = new URLSearchParams(
      typeof window !== "undefined"
        ? window.location.search
        : searchParams.toString(),
    );
    const nextSearchParams = applyProjectIdSearchParam(
      paramsForMerge,
      projectId,
    );
    const nextQuery = nextSearchParams.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function handleSelect(projectId: string | null) {
    applyProjectId(projectId);
    handleOpenChange(false);
  }

  function handleCreateOpen() {
    handleOpenChange(false);
    setCreateOpen(true);
  }

  function handleCreated(result: {
    projectId: string;
    name: string;
    project?: Project;
  }) {
    onProjectCreated({
      id: result.projectId,
      name: result.project?.name ?? result.name,
      logo: result.project?.logo ?? null,
      designMd: result.project?.designMd ?? null,
      briefingUrl: result.project?.briefingUrl ?? null,
      contextMd: result.project?.contextMd ?? null,
    });
    applyProjectId(result.projectId);
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={t("ariaLabel")}
            data-testid="tasks-project-switcher"
            data-selected={isProjectScoped ? "true" : "false"}
            className={cn(
              "max-w-72 justify-start gap-2 font-medium",
              isProjectScoped
                ? "border-transparent bg-accent text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground"
                : "text-foreground",
            )}
          >
            {selectedProject ? (
              <ProjectAvatar
                name={selectedProject.name}
                logo={selectedProject.logo}
                className="size-5 shrink-0"
              />
            ) : (
              <Folder className="size-4 shrink-0" aria-hidden />
            )}
            <span
              className="min-w-0 flex-1 truncate"
              title={selectedProject?.name ?? t("allProjects")}
            >
              {selectedProject?.name ?? t("allProjects")}
            </span>
            <ChevronDown
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command shouldFilter>
            <CommandInput
              autoFocus
              placeholder={t("searchPlaceholder")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={ALL_PROJECTS_VALUE}
                  keywords={[t("allProjects")]}
                  data-testid="tasks-project-switcher-all"
                  onSelect={() => handleSelect(null)}
                >
                  <Folder className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{t("allProjects")}</span>
                  <Check
                    className={cn(
                      "size-4",
                      selectedProjectId === null ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </CommandItem>
                {projectOptions.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.id}
                    keywords={[project.name]}
                    data-testid={`tasks-project-switcher-item-${project.id}`}
                    onSelect={() => handleSelect(project.id)}
                  >
                    <ProjectAvatar
                      name={project.name}
                      logo={project.logo}
                      className="size-5 shrink-0"
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    <Check
                      className={cn(
                        "size-4",
                        project.id === selectedProjectId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                      aria-hidden
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  forceMount
                  value={CREATE_PROJECT_VALUE}
                  keywords={[t("create")]}
                  data-testid="tasks-project-switcher-create"
                  onSelect={handleCreateOpen}
                >
                  <Plus className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{t("create")}</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <InlineCreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </>
  );
}
