import { getTranslations } from "next-intl/server";

import {
  DesignMdLoadError,
  fetchDesignMdMarkdown,
} from "@/components/design-md/design-md-edit-page-shared";
import { DesignMdEditor } from "@/components/design-md-editor/design-md-editor";
import { projectService } from "@/lib/services/project.service";

interface ProjectDesignMdEditPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectDesignMdEditPage({
  params,
}: ProjectDesignMdEditPageProps) {
  const t = await getTranslations("App.DesignMd");
  const tProject = await getTranslations("App.Projects.Detail");
  const { projectId } = await params;
  const returnHref = `/projects/${projectId}`;

  const project = await projectService.getProjectById(projectId);
  if (!project) {
    return (
      <DesignMdLoadError
        backHref="/projects"
        backLabel={tProject("back")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const designMdUrl = project.designMd?.url;
  if (!designMdUrl) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={tProject("backToProject")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const loadResult = await fetchDesignMdMarkdown(designMdUrl);
  if ("error" in loadResult) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={tProject("backToProject")}
        description={t("editLoadErrorDescription")}
        title={t("editLoadErrorTitle")}
      />
    );
  }

  return (
    <DesignMdEditor
      initialMarkdown={loadResult.markdown}
      owner={{ type: "project", projectId: project.id }}
      returnHref={returnHref}
    />
  );
}
