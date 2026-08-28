import { getTranslations } from "next-intl/server";

import { ProjectsView } from "@/app/projects/components/projects-view";
import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import { projectService } from "@/lib/services/project.service";

interface ProjectsPageProps {
  searchParams: Promise<{
    create?: string;
  }>;
}

export const metadata = {
  title: "Projects",
};

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const { create } = await searchParams;
  const projectsPagePromise = projectService.listProjects({
    limit: PROJECTS_PAGE_LIMIT,
  });
  const translationsPromise = getTranslations("App.Projects");

  const [projectsPage, t] = await Promise.all([
    projectsPagePromise,
    translationsPromise,
  ]);
  const initialCreateProjectOpen = create === "true";

  return (
    <div className="w-full px-2">
      <ProjectsView
        key={projectsPage.projects
          .map((project) => `${project.id}:${project.updatedAt}`)
          .join("|")}
        projects={projectsPage.projects}
        nextCursor={projectsPage.pagination?.nextCursor ?? null}
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
        }}
      />
    </div>
  );
}
