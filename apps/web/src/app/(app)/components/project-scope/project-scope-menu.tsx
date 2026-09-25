"use client";

import { Check, FolderKanban, Layers, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import { type ScopeProject, useScopeProjects } from "./use-scope-projects";

const WORKSPACE_VALUE = "__workspace__";
const CREATE_VALUE = "__create_project__";
const MANAGE_VALUE = "__manage_projects__";

interface ProjectScopeMenuProps {
  selectedProjectId: string | null;
  /** A project id, or null for the workspace view. */
  onSelect: (projectId: string | null) => void;
  onCreate: () => void;
  /** Closes whatever holds the menu. Runs after every choice. */
  onDone?: () => void;
  className?: string;
}

/**
 * The one project list every switcher shows: search, the workspace view,
 * Pinned, Recent, all projects, then Create and Manage. Search asks Core, so
 * the list filters itself off.
 */
export function ProjectScopeMenu({
  selectedProjectId,
  onSelect,
  onCreate,
  onDone,
  className,
}: ProjectScopeMenuProps) {
  const t = useTranslations("App.ProjectScope");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const projects = useScopeProjects({ search, selectedProjectId });

  function choose(projectId: string | null) {
    onSelect(projectId);
    onDone?.();
  }

  function row(project: ScopeProject, group: string) {
    return (
      <CommandItem
        key={`${group}-${project.id}`}
        value={`${group}-${project.id}`}
        data-testid={`project-scope-item-${project.id}`}
        onSelect={() => choose(project.id)}
      >
        <ProjectAvatar
          name={project.name}
          logo={project.logo}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <Check
          className={cn(
            "size-4 shrink-0",
            project.id === selectedProjectId ? "opacity-100" : "opacity-0",
          )}
          aria-hidden
        />
      </CommandItem>
    );
  }

  const shortlistIds = new Set(
    [...projects.pinned, ...projects.recent].map((project) => project.id),
  );
  const rest = projects.isSearching
    ? projects.all
    : projects.all.filter((project) => !shortlistIds.has(project.id));

  return (
    <Command shouldFilter={false} className={className}>
      <CommandInput
        autoFocus
        placeholder={t("searchPlaceholder")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {projects.isError ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p role="status" className="text-muted-foreground text-sm">
              {t("error")}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={projects.refetch}
            >
              {t("retry")}
            </Button>
          </div>
        ) : projects.isPending ? (
          <p role="status" className="text-muted-foreground px-3 py-2 text-sm">
            {t("loading")}
          </p>
        ) : projects.isSearching && rest.length === 0 ? (
          // Not `CommandEmpty`: Create and Manage are always mounted, so
          // cmdk never counts the list as empty.
          <p role="status" className="text-muted-foreground px-3 py-2 text-sm">
            {t("empty")}
          </p>
        ) : null}

        {projects.isSearching ? null : (
          <CommandGroup>
            <CommandItem
              value={WORKSPACE_VALUE}
              data-testid="project-scope-workspace"
              onSelect={() => choose(null)}
            >
              <Layers className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{t("workspaceView")}</span>
              <Check
                className={cn(
                  "size-4 shrink-0",
                  selectedProjectId === null ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
            </CommandItem>
          </CommandGroup>
        )}

        {!projects.isSearching && projects.pinned.length > 0 ? (
          <CommandGroup heading={t("pinned")}>
            {projects.pinned.map((project) => row(project, "pinned"))}
          </CommandGroup>
        ) : null}
        {!projects.isSearching && projects.recent.length > 0 ? (
          <CommandGroup heading={t("recent")}>
            {projects.recent.map((project) => row(project, "recent"))}
          </CommandGroup>
        ) : null}
        {rest.length > 0 ? (
          <CommandGroup heading={projects.isSearching ? undefined : t("all")}>
            {rest.map((project) => row(project, "all"))}
          </CommandGroup>
        ) : null}

        <CommandSeparator alwaysRender />
        <CommandGroup forceMount>
          <CommandItem
            forceMount
            value={CREATE_VALUE}
            data-testid="project-scope-create"
            onSelect={() => {
              onDone?.();
              onCreate();
            }}
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{t("create")}</span>
          </CommandItem>
          <CommandItem
            forceMount
            value={MANAGE_VALUE}
            data-testid="project-scope-manage"
            onSelect={() => {
              onDone?.();
              router.push("/projects");
            }}
          >
            <FolderKanban className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{t("manage")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
