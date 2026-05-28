import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ProjectDescription } from "@/app/projects/components/project-description";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    return notFound();
  }

  const [t, locale] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getLocale(),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 pb-8">
        <ProjectDetailHeader
          projectName={project.name}
          backLabel={t("back")}
          metadata={[
            {
              label: t("header.updated"),
              value: formatShortDateTime(project.updatedAt, locale),
            },
            {
              label: t("header.created"),
              value: formatShortDateTime(project.createdAt, locale),
            },
          ]}
          actions={
            <ProjectDetailActions
              projectId={project.id}
              labels={{
                edit: t("actions.edit"),
                delete: t("actions.delete"),
                deleteDialog: {
                  title: t("deleteDialog.title"),
                  description: t("deleteDialog.description"),
                  confirm: t("deleteDialog.confirm"),
                  cancel: t("deleteDialog.cancel"),
                  error: t("errors.delete"),
                },
              }}
            />
          }
        />

        <div className="mt-6 space-y-8">
          <ProjectDescription
            title={t("description")}
            description={project.description}
            emptyLabel={t("emptyDescription")}
          />
        </div>
      </div>
    </div>
  );
}
