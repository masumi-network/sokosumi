import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectsPageSkeleton } from "@/app/projects/components/projects-loading-view";
import { ProjectsView } from "@/app/projects/components/projects-view";
import {
  PROJECTS_PAGE_LIMIT,
  PROJECTS_PAGE_SHELL_CLASS,
} from "@/app/projects/constants";
import { projectService } from "@/lib/services/project.service";

interface ProjectsPageProps {
  searchParams: Promise<{
    create?: string;
    q?: string;
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

  const { create, q } = await searchParams;
  const query = q?.trim() ?? "";
  const projectsPagePromise = projectService.listProjects({
    limit: PROJECTS_PAGE_LIMIT,
    query,
  });
  const translationsPromise = getTranslations("App.Projects");

  const [projectsPage, t] = await Promise.all([
    projectsPagePromise,
    translationsPromise,
  ]);
  const initialCreateProjectOpen = create === "true";

  return (
    <div className={PROJECTS_PAGE_SHELL_CLASS}>
      <ProjectsView
        key={`${query}|${projectsPage.projects
          .map((project) => `${project.id}:${project.updatedAt}`)
          .join("|")}`}
        projects={projectsPage.projects}
        nextCursor={projectsPage.pagination?.nextCursor ?? null}
        query={query}
        initialCreateProjectOpen={initialCreateProjectOpen}
        createProjectModalResetKey={String(initialCreateProjectOpen)}
        labels={{
          newProject: t("empty.action"),
          empty: {
            title: t("empty.title"),
            description: t("empty.description"),
            action: t("empty.action"),
          },
          loadMore: t("list.loadMore"),
          loading: t("list.loading"),
          loadMoreError: t("Detail.errors.loadMore"),
          counts: {
            tasks: t("list.stats.tasks"),
            jobs: t("list.stats.jobs"),
          },
          lastActivity: t("list.lastActivity"),
          created: t("list.created"),
          filter: {
            placeholder: t("list.filter.placeholder"),
            clear: t("list.filter.clear"),
          },
          sortedBy: t("list.sortedBy"),
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
