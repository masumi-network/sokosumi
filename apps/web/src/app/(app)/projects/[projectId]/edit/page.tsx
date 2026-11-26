import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ProjectEditModal } from "@/app/projects/components/project-edit-modal";
import { briefingCopySources } from "@/app/projects/project-briefing";
import { projectService } from "@/lib/services/project.service";

export const metadata: Metadata = {
  title: "Edit project",
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Core lists only the active workspace's projects the reader can open.
  const [project, { projects }] = await Promise.all([
    projectService.getProjectById(projectId),
    // ponytail: first 100 projects only; page through if a workspace outgrows it.
    projectService.listProjects({ limit: 100 }),
  ]);

  if (!project) {
    return notFound();
  }
  // CMO edits a CMO Project; the Project page says so and links there.
  if (project.cmo) redirect(`/projects/${projectId}`);

  const t = await getTranslations("App.Projects");

  return (
    <ProjectEditModal
      projectId={projectId}
      title={t("EditProject.title")}
      labels={{
        details: t("EditProject.details"),
        detailsDescription: t("EditProject.detailsDescription"),
        name: t("EditProject.name"),
        namePlaceholder: t("EditProject.namePlaceholder"),
        submit: t("EditProject.save"),
        cancel: t("EditProject.cancel"),
        error: t("Detail.errors.update"),
      }}
      briefingCopySources={briefingCopySources(projects, projectId)}
      initialValues={{
        name: project.name,
        identifier: project.identifier,
        briefing: project.briefing ?? "",
        websiteUrl: project.websiteUrl,
      }}
    />
  );
}
