import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { SECTION_MARKDOWN_HEADINGS } from "@/app/projects/components/section-markdown-headings";
import { fetchDesignMdMarkdown } from "@/components/design-md/design-md-edit-page-shared";
import Markdown from "@/components/markdown";
import { projectService } from "@/lib/services/project.service";

// Wait for the current session and project access before rendering, as the
// project's other areas do.
export const instant = false;

interface ProjectDesignPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The Design tab: a project's DESIGN.md, read here rather than downloaded.
 *
 * The document was only ever reachable as a blob URL in a dropdown or as raw
 * Markdown in the editor, so "what does this project look like" meant leaving
 * the project. The card above it is the same `ProjectBrandCard` the overview
 * shows, because every action on this file — generate, upload, open raw, edit,
 * remove — already lives there and a second copy of those buttons would be a
 * second thing to keep in step.
 */
export default async function ProjectDesignPage({
  params,
}: ProjectDesignPageProps) {
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [t, tDesignMd, formatter] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getTranslations("App.DesignMd"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  const designMdUrl = project.designMd?.url;
  const loaded = designMdUrl ? await fetchDesignMdMarkdown(designMdUrl) : null;

  return (
    <ProjectWorkspaceShell
      actions={
        <ProjectHeaderActions
          closedAt={project.closedAt}
          closingAt={project.closingAt}
          projectId={project.id}
          projectRevision={project.projectRevision}
        />
      }
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
    >
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        projectId={project.id}
        initialDesignMd={project.designMd}
        websiteUrl={project.websiteUrl}
      >
        <div className="max-w-3xl min-w-0 space-y-8">
          <ProjectBrandCard
            projectId={project.id}
            websiteUrl={project.websiteUrl}
          />

          {/* With no DESIGN.md the brand section above already says so and
              offers the ways to add one. */}
          {loaded ? (
            <section
              className="space-y-2"
              data-testid="project-design-document"
            >
              <h2 className="text-muted-foreground text-xs font-medium">
                {t("design.document")}
              </h2>
              {"markdown" in loaded ? (
                <Markdown
                  className="text-foreground"
                  components={SECTION_MARKDOWN_HEADINGS}
                >
                  {loaded.markdown}
                </Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {tDesignMd("editLoadErrorDescription")}
                </p>
              )}
            </section>
          ) : null}
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
