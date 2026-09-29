import { getTranslations } from "next-intl/server";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import {
  ProjectProperties,
  type ProjectPropertiesLabels,
} from "@/app/projects/components/project-properties";
import {
  type ProjectTab,
  ProjectTabs,
} from "@/app/projects/components/project-tabs";
import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";
import { cn } from "@/lib/utils";

export interface ProjectWorkspaceLabels {
  ariaLabel: string;
  design: string;
  memory: string;
  overview: string;
  properties: ProjectPropertiesLabels;
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
  const t = await getTranslations("App.Projects.Detail");
  return {
    ariaLabel: t("tabs.ariaLabel"),
    design: t("tabs.design"),
    memory: t("tabs.memory"),
    overview: t("tabs.overview"),
    properties: {
      title: t("header.properties"),
      website: t("header.website"),
      updated: t("header.updated"),
      created: t("header.created"),
    },
  };
}

interface ProjectWorkspaceShellProps {
  actions?: React.ReactNode;
  children: React.ReactNode;
  labels: ProjectWorkspaceLabels;
  /** Formatted by the page, which already holds a formatter. */
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectLogo?: string | null;
  projectName: string;
  websiteUrl?: string | null;
}

/**
 * A project page, laid out like a task page.
 *
 * Same shell, grid and columns as the task detail (`TASK_DETAIL_*`), so the
 * two detail pages share one width and one rhythm and move together when the
 * task layout changes. The header, tabs and active area form the main column;
 * the Properties rail sits in the right column from `xl` up. Below `xl` the
 * rail follows the header, so the website and dates stay near the name and
 * the tabs stay against the content they switch.
 *
 * No card: content sits on the page ground, as it does on a task. Areas render
 * their sections with the quiet heading the task sections use.
 */
export function ProjectWorkspaceShell({
  actions,
  children,
  labels,
  createdAt,
  updatedAt,
  projectId,
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
    <div className={TASK_DETAIL_SHELL_CLASS}>
      {/* Rows sit 16px apart: on a wide screen that joins the name to its
          tabs, and in one column it joins the name to its Properties. The
          tabs block adds 16px in one column, so the Properties close their
          group before the tabs start. The 56px column gap keeps the header's
          actions clear of the rail. */}
      <div className={cn(TASK_DETAIL_GRID_CLASS, "gap-y-4 xl:gap-x-14")}>
        <ProjectDetailHeader
          actions={actions}
          projectLogo={projectLogo}
          projectName={projectName}
        />

        {/* Capped so a row's qualifier stays near its value while the rail
            runs the full width of a single column. */}
        <aside className={cn(TASK_DETAIL_SIDEBAR_CLASS, "max-w-sm")}>
          <ProjectProperties
            createdAt={createdAt}
            labels={labels.properties}
            updatedAt={updatedAt}
            websiteUrl={websiteUrl}
          />
        </aside>

        {/* The tabs open the block they switch, so nothing (not the rail,
            which comes before this on a phone) sits between a tab and its
            content. */}
        <div className="min-w-0 space-y-8 max-xl:mt-4">
          <ProjectTabs ariaLabel={labels.ariaLabel} tabs={tabs} />
          {children}
        </div>
      </div>
    </div>
  );
}
