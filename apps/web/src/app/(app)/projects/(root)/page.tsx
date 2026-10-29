import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectsPageSkeleton } from "@/app/projects/components/projects-loading-view";
import { ProjectsView } from "@/app/projects/components/projects-view";
import {
  PROJECTS_PAGE_LIMIT,
  PROJECTS_PAGE_SHELL_CLASS,
  projectsListStateQuery,
} from "@/app/projects/constants";
import { loadProjectsSearchParams } from "@/app/projects/projects-query";
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

/**
 * Async hole for Instant Nav. `await connection()` first so PPR shell probing
 * does not soft-reject cookies()/headers()-bound work while filling Suspense.
 */
export async function ProjectsPageContent({ searchParams }: ProjectsPageProps) {
  await connection();

  const params = await searchParams;
  const { create, q } = params;
  const query = q?.trim() ?? "";
  const { state } = loadProjectsSearchParams(params);
  const projectsPagePromise = projectService.listProjects({
    limit: PROJECTS_PAGE_LIMIT,
    query,
    ...projectsListStateQuery(state),
  });
  const translationsPromise = getTranslations("App.Projects");

  const [projectsPage, t] = await Promise.all([
    projectsPagePromise,
    translationsPromise,
  ]);
  // An empty Open view reads "No projects yet" only when there is truly
  // nothing; one Closed project is enough to say "all closed" instead.
  const hasClosedProjects =
    state === "open" &&
    !query &&
    projectsPage.projects.length === 0 &&
    (await projectService.listProjects({ limit: 1, state: "closed" })).projects
      .length > 0;
  const initialCreateProjectOpen = create === "true";

  return (
    <div className={PROJECTS_PAGE_SHELL_CLASS}>
      <ProjectsView
        projects={projectsPage.projects}
        nextCursor={projectsPage.pagination?.nextCursor ?? null}
        query={query}
        state={state}
        hasClosedProjects={hasClosedProjects}
        initialCreateProjectOpen={initialCreateProjectOpen}
        createProjectModalResetKey={String(initialCreateProjectOpen)}
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
          pin: t("list.pin"),
          unpin: t("list.unpin"),
          pinError: t("list.pinError"),
          closed: t("list.closed"),
          state: {
            label: t("list.state.label"),
            open: t("list.state.open"),
            closed: t("list.state.closed"),
          },
          filter: {
            placeholder: t("list.filter.placeholder"),
            clear: t("list.filter.clear"),
          },
          noMatches: t("list.filter.noMatches", { query }),
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
