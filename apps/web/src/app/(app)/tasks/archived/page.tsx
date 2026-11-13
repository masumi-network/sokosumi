import { Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { BackToTasksButton } from "@/app/tasks/components/back-to-tasks-button";
import { Input } from "@/components/ui/input";
import { taskService } from "@/lib/services/task.service";

import { ArchivedTasksList } from "./archived-tasks-list";

// Blocks on the search and the archived list; there is no shell worth showing first.
export const instant = false;

// ponytail: one page of the latest archives; add Load more when people keep more.
const ARCHIVED_TASKS_LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Archived");
  return { title: t("title"), description: t("description") };
}

/** Archived Tasks of the active workspace the viewer can see, to restore. */
export default async function ArchivedTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await connection();
  const { q: rawQuery } = await searchParams;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim();
  const [t, format, { tasks }] = await Promise.all([
    getTranslations("App.Tasks.Archived"),
    getFormatter(),
    taskService.listTasks({
      archived: true,
      scope: "workspace",
      limit: ARCHIVED_TASKS_LIMIT,
      ...(query ? { q: query } : {}),
    }),
  ]);

  return (
    <div className="content-in flex w-full flex-col gap-4 pb-6">
      <BackToTasksButton label={t("back")} />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Form action="/tasks/archived" role="search" className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="pl-9"
        />
      </Form>
      <ArchivedTasksList
        // Remount on a new search, so restored rows from the last one go.
        key={query ?? ""}
        query={query}
        tasks={tasks.map((task) => ({
          id: task.id,
          identifier: task.identifier,
          name: task.name,
          status: task.status,
          project: task.project?.name ?? null,
          archivedOn: task.archivedAt
            ? format.dateTime(task.archivedAt, { dateStyle: "medium" })
            : null,
        }))}
      />
    </div>
  );
}
