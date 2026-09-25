"use client";

import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { isProjectScopedPath } from "@/app/components/project-scope/project-scope-href";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { useSelectedScopeProject } from "@/app/components/project-scope/use-scope-projects";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";

import type { ScopeSlots } from "./scope-variants";
import { HubProjectHeader } from "./variant-hub-project";

/**
 * The project a scoped workspace page shows, or null. Project pages carry
 * their own switcher in the project header, so they never count here.
 */
function useScopedWorkspaceProject() {
  const pathname = usePathname();
  const scope = useProjectScopeSwitch();
  const scopedProjectId = isProjectScopedPath(pathname)
    ? scope.projectId
    : null;
  const selectedProject = useSelectedScopeProject(scopedProjectId);

  if (!scopedProjectId) return null;
  return {
    id: scopedProjectId,
    href: `/projects/${encodeURIComponent(scopedProjectId)}`,
    name: selectedProject?.name ?? null,
    logo: selectedProject?.logo ?? null,
    clear: () => scope.select(null),
  };
}

/** Leaves the project scope in place: the workspace version of this page. */
function ClearScopeButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("App.ProjectScope");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t("workspaceView")}
      className="text-muted-foreground size-6 shrink-0 px-0 has-[>svg]:px-0"
      onClick={onClick}
    >
      <X className="size-3.5" aria-hidden />
    </Button>
  );
}

/** sm and up: "‹avatar› Project ×  ›" before the page breadcrumbs. */
function HubHeaderCrumb() {
  const t = useTranslations("App.ProjectScope");
  const project = useScopedWorkspaceProject();
  if (!project) return null;

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      <Link
        href={project.href}
        className="hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2"
      >
        {project.name ? (
          // The avatar's fallback initial would join the link's name.
          <span aria-hidden className="shrink-0">
            <ProjectAvatar
              name={project.name}
              logo={project.logo}
              className="size-5 shrink-0"
            />
          </span>
        ) : null}
        <span className="sr-only">{t("label")}: </span>
        <span className="max-w-40 truncate">{project.name ?? t("label")}</span>
      </Link>
      <ClearScopeButton onClick={project.clear} />
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </div>
  );
}

/** Below sm: the project's avatar, linking to the project, and a clear. */
function HubHeaderMobileChip() {
  const t = useTranslations("App.ProjectScope");
  const project = useScopedWorkspaceProject();
  if (!project) return null;

  const label = project.name ? `${t("label")}: ${project.name}` : t("label");

  return (
    <div className="flex shrink-0 items-center sm:hidden">
      <Link
        href={project.href}
        aria-label={label}
        className="hover:bg-accent focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2"
      >
        <ProjectAvatar
          name={project.name ?? t("label")}
          logo={project.logo}
          className="size-6"
        />
      </Link>
      <ClearScopeButton onClick={project.clear} />
    </div>
  );
}

/** SOK-1202 variant "hub": the switcher lives with the project. */
export const hubSlots: ScopeSlots = {
  "project-header": HubProjectHeader,
  "header-center": HubHeaderCrumb,
  "header-mobile": HubHeaderMobileChip,
};
