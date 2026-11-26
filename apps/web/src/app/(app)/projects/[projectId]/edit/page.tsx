import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ProjectEditModal } from "@/app/projects/components/project-edit-modal";
import { projectService } from "@/lib/services/project.service";

import { loadBriefingCopySources } from "./briefing-copy-sources";

export const metadata: Metadata = {
  title: "Edit project",
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    return notFound();
  }
  // CMO edits a CMO Project; the Project page says so and links there.
  if (project.cmo) redirect(`/projects/${projectId}`);

  const [t, copySources] = await Promise.all([
    getTranslations("App.Projects"),
    loadBriefingCopySources(projectId),
  ]);

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
      briefingCopySources={copySources}
      initialValues={{
        name: project.name,
        identifier: project.identifier,
        briefing: project.briefing ?? "",
        websiteUrl: project.websiteUrl,
      }}
    />
  );
}
