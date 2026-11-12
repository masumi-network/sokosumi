import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { BackToTasksButton } from "@/app/tasks/components/back-to-tasks-button";
import { taskService } from "@/lib/services/task.service";

import { ArchivedTasksList } from "./archived-tasks-list";

// ponytail: one page of the latest archives; add Load more when people keep more.
const ARCHIVED_TASKS_LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Archived");
  return { title: t("title"), description: t("description") };
}

/** Archived Tasks of the active workspace the viewer can see, to restore. */
export default async function ArchivedTasksPage() {
  await connection();
  const [t, { tasks }] = await Promise.all([
    getTranslations("App.Tasks.Archived"),
    taskService.listTasks({
      archived: true,
      scope: "workspace",
      limit: ARCHIVED_TASKS_LIMIT,
    }),
  ]);

  return (
    <div className="content-in flex w-full flex-col gap-4 pb-6">
      <BackToTasksButton label={t("back")} />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <ArchivedTasksList
        tasks={tasks.map(({ id, identifier, name, status }) => ({
          id,
          identifier,
          name,
          status,
        }))}
      />
    </div>
  );
}
