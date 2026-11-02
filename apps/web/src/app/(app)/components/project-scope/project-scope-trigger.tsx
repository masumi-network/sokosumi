"use client";

import { FolderKanban, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RefObject } from "react";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useSelectedScopeProject } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Badge } from "@/components/ui/badge";

/*
 * What every Project switcher trigger shares: the header's selector, the
 * phone chip and the phone sidebar's title.
 */

/**
 * The current scope as a name and a mark. The sidebar's title shows the name
 * alone; the header chip shows both. The mark's glyph names no size: the
 * chip's box gives it one.
 */
export function useCurrentScope() {
  const t = useTranslations("App.ProjectScope");
  const scope = useProjectScopeSwitch();
  const selectedProject = useSelectedScopeProject(scope.projectId);
  // A project still loading reads as "Project", never as the workspace.
  const name =
    scope.projectId === null
      ? t("allProjects")
      : (selectedProject?.name ?? t("label"));
  // A Closed project never lists, but it can still be the scope.
  const closed = scope.projectId !== null && selectedProject?.closed === true;

  return {
    ...scope,
    name,
    closed,
    /** "Project: Acme", "Project: Acme, Closed", for accessible names. */
    label: closed
      ? `${t("label")}: ${name}, ${t("closed")}`
      : `${t("label")}: ${name}`,
    mark:
      scope.projectId === null ? (
        <Layers className="shrink-0" aria-hidden />
      ) : selectedProject ? (
        <ProjectAvatar
          name={selectedProject.name}
          logo={selectedProject.logo}
          className="size-5 shrink-0"
        />
      ) : (
        <FolderKanban className="shrink-0" aria-hidden />
      ),
  };
}

/**
 * The × beside a trigger: back to All projects. The × unmounts with the
 * scope, so focus moves to the trigger it sits beside.
 */
export function useClearScope(trigger: RefObject<HTMLElement | null>) {
  const { select } = useProjectScopeSwitch();
  return () => {
    select(null);
    trigger.current?.focus();
  };
}

/** The small Closed badge a trigger shows beside a Closed project's name. */
export function ScopeClosedBadge() {
  const t = useTranslations("App.ProjectScope");
  return (
    <Badge
      variant="secondary"
      aria-hidden
      data-testid="project-scope-closed-badge"
    >
      {t("closed")}
    </Badge>
  );
}
