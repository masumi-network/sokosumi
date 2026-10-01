import { getTranslations } from "next-intl/server";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import {
  type ProjectTab,
  ProjectTabs,
} from "@/app/projects/components/project-tabs";
import {
  PROJECTS_WORKSPACE_CARD_CLASS,
  PROJECTS_WORKSPACE_GUTTER_CLASS,
  PROJECTS_WORKSPACE_SHELL_CLASS,
} from "@/app/projects/constants";
import { cn } from "@/lib/utils";

export interface ProjectWorkspaceLabels {
  ariaLabel: string;
  backToProjects: string;
  design: string;
  memory: string;
  overview: string;
}

/**
 * The shell's own strings, resolved by the page.
 *
 * A plain async function rather than an async component. Nesting an async
 * Server Component inside a page makes the page untestable with the harness
 * the project pages already use — React will not render an async component
 * below the one being awaited — and every one of these pages is an `async`
 * function that already awaits its translations. One more await is cheaper
 * than an async boundary in the tree.
 */
export async function getProjectWorkspaceLabels(): Promise<ProjectWorkspaceLabels> {
  const t = await getTranslations("App.Projects.Detail.tabs");
  return {
    ariaLabel: t("ariaLabel"),
    backToProjects: t("backToProjects"),
    design: t("design"),
    memory: t("memory"),
    overview: t("overview"),
  };
}

interface ProjectWorkspaceShellProps {
  actions?: React.ReactNode;
  children: React.ReactNode;
  labels: ProjectWorkspaceLabels;
  metadata: { label: string; value: string }[];
  projectId: string;
  projectIdentifier?: string | null;
  projectLogo?: string | null;
  projectName: string;
  websiteUrl?: string | null;
}

/**
 * A project, as one object on the page.
 *
 * Identity, navigation and the active area share a single card — the same
 * card the projects index and Drive already draw — so the tab strip reads as
 * the top edge of the thing it navigates rather than as a rule floating above
 * unrelated content. Before this, a project page was four surfaces stacked in
 * the app gutter with nothing holding them together, and each area then added
 * containers of its own inside that, which is how a panel of tiles ended up
 * nested in a page that had no panel around it.
 *
 * Everything inside shares one horizontal inset, one border weight, one
 * radius. Areas render their content directly onto this surface and should
 * not re-draw it.
 */
export function ProjectWorkspaceShell({
  actions,
  children,
  labels,
  metadata,
  projectId,
  projectIdentifier,
  projectLogo,
  projectName,
  websiteUrl,
}: ProjectWorkspaceShellProps) {
  /**
   * What a project *is*, in three views.
   *
   * The image studio, the calendar and Social used to be tabs here. None of
   * them is part of a project's own record: all three are workspace surfaces
   * that happen to be scoped to one, and they are top-level destinations now.
   * What is left are the three things that only exist because this project
   * exists — what it is, how it should look, and what has been learned about
   * it.
   */
  const tabs: ProjectTab[] = [
    {
      id: "overview",
      // Exact: `/projects/:id/edit` is not the overview tab.
      exact: true,
      href: `/projects/${projectId}`,
      label: labels.overview,
    },
    {
      id: "design",
      href: `/projects/${projectId}/design-md`,
      label: labels.design,
    },
    {
      id: "memory",
      href: `/projects/${projectId}/memory`,
      label: labels.memory,
    },
  ];

  return (
    <div className={PROJECTS_WORKSPACE_SHELL_CLASS}>
      <div className={PROJECTS_WORKSPACE_CARD_CLASS}>
        <ProjectDetailHeader
          actions={actions}
          backHref="/projects"
          backLabel={labels.backToProjects}
          className={cn(PROJECTS_WORKSPACE_GUTTER_CLASS, "pt-4 md:pt-5")}
          metadata={metadata}
          projectIdentifier={projectIdentifier}
          projectLogo={projectLogo}
          projectName={projectName}
          websiteUrl={websiteUrl}
        />

        {/* The tab strip is the card's own divider, with the labels on it.
            That is the whole difference between navigation that belongs to a
            surface and navigation that floats above one. */}
        <ProjectTabs
          ariaLabel={labels.ariaLabel}
          className={PROJECTS_WORKSPACE_GUTTER_CLASS}
          tabs={tabs}
        />

        <div className={cn(PROJECTS_WORKSPACE_GUTTER_CLASS, "min-w-0 py-5")}>
          {children}
        </div>
      </div>
    </div>
  );
}
