import { removeTaskContextAttachmentLinks } from "@sokosumi/utils";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { taskService } from "@/lib/services/task.service";

import { ArchivedTaskRestoreButton } from "./archived-task-restore-button";

// Blocks on the archived Task; a missing one is a 404, not a shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Archived");
  return { title: t("title") };
}

/** One archived Task, read-only, so people can check it before restoring. */
export default async function ArchivedTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  await connection();
  const { taskId } = await params;
  const [task, t, tDetail, tStatus, format] = await Promise.all([
    taskService.getArchivedTask(taskId),
    getTranslations("App.Tasks.Archived"),
    getTranslations("App.Tasks.Detail"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getFormatter(),
  ]);
  if (!task) {
    return notFound();
  }
  const archivedOn = task.archivedAt
    ? format.dateTime(task.archivedAt, { dateStyle: "medium" })
    : null;

  return (
    <div className="content-in flex w-full flex-col gap-4 pb-6">
      <Link
        href="/tasks/archived"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("title")}
      </Link>
      <div className={HOLDER_CLASS}>
        <div className="flex flex-col gap-6 p-4 md:p-6">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              {task.identifier ? (
                <p className="text-muted-foreground text-sm tabular-nums">
                  {task.identifier}
                </p>
              ) : null}
              <h1 className="text-xl font-semibold text-pretty wrap-anywhere">
                {task.name}
              </h1>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <TaskStatusBadge
                  status={task.status}
                  label={tStatus(task.status)}
                  className="w-fit rounded-sm"
                />
                <span>{task.project?.name ?? t("noProject")}</span>
                {archivedOn ? (
                  <span>{t("archivedOn", { date: archivedOn })}</span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-sm text-pretty">
                {t("readOnly")}
              </p>
            </div>
            <ArchivedTaskRestoreButton
              task={{
                id: task.id,
                identifier: task.identifier,
                name: task.name,
              }}
            />
          </header>
          <TaskDescription
            title={tDetail("description")}
            description={
              task.description
                ? removeTaskContextAttachmentLinks(task.description)
                : null
            }
            expandLabel={tDetail("expand")}
            collapseLabel={tDetail("collapse")}
          />
        </div>
      </div>
    </div>
  );
}
