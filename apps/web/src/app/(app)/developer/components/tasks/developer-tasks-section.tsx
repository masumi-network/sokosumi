import { getTranslations } from "next-intl/server";

import { developerTaskService } from "@/lib/services/developer-task.service";

import { DeveloperTaskList } from "./developer-task-list";

export async function DeveloperTasksSection() {
  const t = await getTranslations("App.Developer.Tasks");

  try {
    const initialPage = await developerTaskService.listTasks();

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <DeveloperTaskList initialPage={initialPage} />
      </div>
    );
  } catch {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <p className="text-destructive text-sm">{t("loadFailed")}</p>
      </div>
    );
  }
}
