import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectsPageSkeleton } from "@/app/projects/components/projects-loading-view";
import { ProjectsView } from "@/app/projects/components/projects-view";
import {
  requestPanelFeed,
  WorkspaceColumn,
} from "@/app/projects/components/workspace-column";
import {
  PROJECTS_PAGE_SHELL_CLASS,
  WORKSPACE_COLUMN_ROWS,
} from "@/app/projects/constants";
import { loadProjectsPageData } from "@/app/projects/projects-page-data";
import { loadProjectsSearchParams } from "@/app/projects/projects-query";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { projectService } from "@/lib/services/project.service";

interface ProjectsPageProps {
  searchParams: Promise<{
    create?: string;
    q?: string;
    state?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Projects");

  return {
    title: t("title"),
  };
}

/** Async hole for Instant Nav. */
export async function ProjectsPageContent({ searchParams }: ProjectsPageProps) {
  const params = await searchParams;
  const { create, q } = params;
  const query = q?.trim() ?? "";
  const { state } = loadProjectsSearchParams(params);
  const projectsPageDataPromise = loadProjectsPageData({ query, state });
  const translationsPromise = getTranslations("App.Projects");
  // Started beside the grid's request, awaited inside their own boundaries.
  // Needs you lives on Home, so the list's column is Recent activity alone.
  const column =
    state === "open"
      ? {
          activity: requestPanelFeed(() =>
            projectService.listRecentActivity(WORKSPACE_COLUMN_ROWS),
          ),
        }
      : null;

  const [{ projectsPage, hasClosedProjects, otherMatches }, t, tCmo] =
    await Promise.all([
      projectsPageDataPromise,
      translationsPromise,
      getTranslations("Components.CmoProject"),
    ]);
  const initialCreateProjectOpen = create === "true";

  return (
    <div className={PROJECTS_PAGE_SHELL_CLASS}>
      <RefreshPrefetchedPage />
      <ProjectsView
        projects={projectsPage.projects}
        nextCursor={projectsPage.pagination?.nextCursor ?? null}
        query={query}
        state={state}
        hasClosedProjects={hasClosedProjects}
        otherMatches={otherMatches}
        initialCreateProjectOpen={initialCreateProjectOpen}
        createProjectModalResetKey={String(initialCreateProjectOpen)}
        column={
          column ? (
            <WorkspaceColumn
              activity={column.activity}
              projects={Object.fromEntries(
                projectsPage.projects.map((project) => [
                  project.id,
                  { name: project.name, logo: project.logo },
                ]),
              )}
            />
          ) : null
        }
        labels={{
          newProject: t("empty.action"),
          empty: {
            title: t("empty.title"),
            description: t("empty.description"),
          },
          emptyClosed: {
            title: t("list.emptyClosed.title"),
            description: t("list.emptyClosed.description"),
          },
          emptyHidden: {
            title: t("list.emptyHidden.title"),
            description: t("list.emptyHidden.description"),
          },
          onlyClosed: {
            title: t("list.onlyClosed.title"),
            description: t("list.onlyClosed.description"),
            action: t("list.onlyClosed.action"),
          },
          loadMore: t("list.loadMore"),
          loadMoreError: t("Detail.errors.loadMore"),
          counts: {
            tasks: t("list.stats.tasks"),
            jobs: t("list.stats.jobs"),
          },
          lastActivity: t("list.lastActivity"),
          created: t("list.created"),
          pinned: t("list.pinned"),
          closed: t("list.closed"),
          cmo: tCmo("badge"),
          // No scheduled-posts warning: the list does not count a card's
          // scheduled posts, so the dialog keeps its general description.
          actions: {
            moreActions: t("Detail.actions.moreActions"),
            close: t("Detail.actions.close"),
            pin: {
              pin: t("list.pin"),
              unpin: t("list.unpin"),
              error: t("list.pinError"),
            },
            hide: {
              hide: t("list.hide.hide"),
              show: t("list.hide.show"),
              hidden: t("list.hide.hidden"),
              undo: t("list.hide.undo"),
              hideError: t("list.hide.hideError"),
              showError: t("list.hide.showError"),
            },
            closeDialog: {
              title: t("Detail.close.dialog.title"),
              description: t("Detail.close.dialog.description"),
              reasonLabel: t("Detail.close.dialog.reasonLabel"),
              reasonPlaceholder: t("Detail.close.dialog.reasonPlaceholder"),
              confirm: t("Detail.close.dialog.confirm"),
              cancel: t("Detail.close.dialog.cancel"),
              success: t("Detail.close.dialog.success"),
              error: t("Detail.close.dialog.error"),
            },
          },
          state: {
            label: t("list.state.label"),
            open: t("list.state.open"),
            hidden: t("list.state.hidden"),
            closed: t("list.state.closed"),
          },
          filter: {
            placeholder: t("list.filter.placeholder"),
            clear: t("list.filter.clear"),
          },
          noMatches: t("list.filter.noMatches", { query }),
          noMatchesIn: {
            open: t("list.filter.noMatchesIn.open", { query }),
            hidden: t("list.filter.noMatchesIn.hidden", { query }),
            closed: t("list.filter.noMatchesIn.closed", { query }),
          },
          elsewhere: t("list.filter.elsewhere"),
          showIn: {
            open: t("list.filter.showIn.open"),
            hidden: t("list.filter.showIn.hidden"),
            closed: t("list.filter.showIn.closed"),
          },
        }}
      />
    </div>
  );
}

export default function ProjectsPage({ searchParams }: ProjectsPageProps) {
  return (
    <Suspense fallback={<ProjectsPageSkeleton />}>
      <ProjectsPageContent searchParams={searchParams} />
    </Suspense>
  );
}
