import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { TaskList } from "@/components/admin/tasks/task-list";
import { adminTaskService } from "@/lib/services/admin-task.service";

export const metadata: Metadata = {
  title: "Tasks",
  description: "Searchable list of all tasks",
};

export default async function AdminTasksPage() {
  const t = await getTranslations("App.Admin.Tasks");
  const initialPage = await adminTaskService.listTasks();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <TaskList initialPage={initialPage} />
      </div>
    </div>
  );
}
