import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ProjectEditModal } from "@/app/projects/components/project-edit-modal";
import { projectService } from "@/lib/services/project.service";

export default async function ProjectEditModalPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [projectResult, socialConnectionsResult] = await Promise.allSettled([
    projectService.getProjectById(projectId),
    projectService.listSocialConnections(projectId),
  ]);

  if (projectResult.status === "rejected") {
    throw projectResult.reason;
  }

  const project = projectResult.value;

  if (!project) {
    return notFound();
  }

  if (socialConnectionsResult.status === "rejected") {
    throw socialConnectionsResult.reason;
  }

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
      initialValues={{
        name: project.name,
        briefing: project.briefing ?? "",
        websiteUrl: project.websiteUrl,
      }}
      socialConnections={socialConnectionsResult.value}
    />
  );
}
