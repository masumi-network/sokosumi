import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ProjectEditModal } from "@/app/projects/components/project-edit-modal";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { projectService } from "@/lib/services/project.service";

export const metadata: Metadata = {
  title: "Edit Project",
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [socialBetaEnabled, { projectId }] = await Promise.all([
    hasCurrentUserCalendarBetaAccess(),
    params,
  ]);
  const [projectResult, socialConnectionsResult] = await Promise.allSettled([
    projectService.getProjectById(projectId),
    socialBetaEnabled
      ? projectService.listSocialConnections(projectId)
      : Promise.resolve(undefined),
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
