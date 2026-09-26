import { getTranslations } from "next-intl/server";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import {
  type ProjectTab,
  ProjectTabs,
} from "@/app/projects/components/project-tabs";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";

export interface ProjectWorkspaceLabels {
  ariaLabel: string;
  backToProjects: string;
  calendar: string;
  imageStudio: string;
  overview: string;
  social: string;
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
    calendar: t("calendar"),
    imageStudio: t("imageStudio"),
    overview: t("overview"),
    social: t("social"),
  };
}

interface ProjectWorkspaceShellProps {
  actions?: React.ReactNode;
  children: React.ReactNode;
  labels: ProjectWorkspaceLabels;
  metadata: { label: string; value: string }[];
  projectId: string;
  projectLogo?: string | null;
  projectName: string;
  /** The social tab exists only for workspaces in the social beta. */
  showSocialTab: boolean;
  websiteUrl?: string | null;
}

/**
 * The chrome every project subpage shares: one header, one tab row, and the
 * full width of the application shell.
 *
 * Before this, each subpage drew its own header and its own "Back to project"
 * link, which is how a project's areas came to read as four unrelated pages
 * that happened to be about the same project. The tabs make the relationship
 * the navigation, so the back link goes back to the project *list* — the only
 * place left to go up to.
 */
export function ProjectWorkspaceShell({
  actions,
  children,
  labels,
  metadata,
  projectId,
  projectLogo,
  projectName,
  showSocialTab,
  websiteUrl,
}: ProjectWorkspaceShellProps) {
  const tabs: ProjectTab[] = [
    {
      id: "overview",
      // Exact: `/projects/:id/edit` is not the overview tab.
      exact: true,
      href: `/projects/${projectId}`,
      label: labels.overview,
    },
    {
      id: "studio",
      href: `/projects/${projectId}/studio`,
      label: labels.imageStudio,
    },
    {
      id: "calendar",
      href: `/projects/${projectId}/calendar`,
      label: labels.calendar,
    },
    ...(showSocialTab
      ? [
          {
            id: "social",
            href: `/projects/${projectId}/social`,
            label: labels.social,
          },
        ]
      : []),
  ];

  return (
    <div className={PROJECTS_WORKSPACE_SHELL_CLASS}>
      <ProjectDetailHeader
        actions={actions}
        backHref="/projects"
        backLabel={labels.backToProjects}
        metadata={metadata}
        projectLogo={projectLogo}
        projectName={projectName}
        showBackOnMobile
        websiteUrl={websiteUrl}
      />

      <div className="mt-5">
        <ProjectTabs ariaLabel={labels.ariaLabel} tabs={tabs} />
      </div>

      <div className="mt-6 min-w-0">{children}</div>
    </div>
  );
}
