import { getTranslations } from "next-intl/server";

import { ProjectsLoadingView } from "@/app/projects/components/projects-loading-view";

export default async function ProjectsRootLoading() {
  const t = await getTranslations("App.Projects");

  return (
    <div className="w-full px-2">
      <ProjectsLoadingView
        labels={{
          newProject: t("empty.action"),
        }}
      />
    </div>
  );
}
