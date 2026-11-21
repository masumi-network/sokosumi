import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { taskService } from "@/lib/services/task.service";

import { readArchivedSearch } from "./archived-search";
import { ArchivedTasksHeader } from "./archived-tasks-header";
import { ArchivedTasksList } from "./archived-tasks-list";
import { ArchivedTasksLoading } from "./archived-tasks-loading";

// ponytail: one page of the latest archives; add Load more when people keep more.
const ARCHIVED_TASKS_LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Archived");
  return { title: t("title"), description: t("description") };
}

interface ArchivedTasksPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

async function ArchivedTasksContent({ searchParams }: ArchivedTasksPageProps) {
  await connection();
  const query = readArchivedSearch((await searchParams).q);
  const [t, format, { tasks, pagination }] = await Promise.all([
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
    <div className="flex w-full flex-col gap-4 pb-6">
      <ArchivedTasksHeader t={t} query={query} />
      <ArchivedTasksList
        query={query}
        total={pagination?.total ?? tasks.length}
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

/**
 * Archived Tasks of the active workspace the viewer can see, to restore. The
 * heading, search and row frames show at once; the rows fill in.
 */
export default function ArchivedTasksPage({
  searchParams,
}: ArchivedTasksPageProps) {
  return (
    <Suspense fallback={<ArchivedTasksLoading />}>
      <ArchivedTasksContent searchParams={searchParams} />
    </Suspense>
  );
}
