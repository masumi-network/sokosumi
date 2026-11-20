import {
  removeSeoTaskRequest,
  removeTaskContextAttachmentLinks,
} from "@sokosumi/utils";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { taskService } from "@/lib/services/task.service";
import { cn } from "@/lib/utils";

import { ArchivedTaskLoading } from "../archived-tasks-loading";
import { ArchivedTaskBackLink } from "./archived-task-back-link";
import { ArchivedTaskRestoreButton } from "./archived-task-restore-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Archived");
  return { title: t("title") };
}

interface ArchivedTaskPageProps {
  params: Promise<{ taskId: string }>;
}

async function ArchivedTaskContent({ params }: ArchivedTaskPageProps) {
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
    <div className="flex w-full flex-col gap-4 pb-6">
      <ArchivedTaskBackLink label={t("title")} />
      {/* Fades in alone: the loading shell already drew the back link. */}
      <div className={cn(HOLDER_CLASS, "content-in")}>
        <div className="flex flex-col gap-6 p-4 md:p-6">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              {/* The identifier leads the title, as on the list row, so no
                  line depends on whether the Task has one and the loading
                  frame holds for both. */}
              <h1 className="text-xl font-semibold text-pretty wrap-anywhere">
                {task.identifier ? (
                  <span className="text-muted-foreground me-2 font-normal tabular-nums">
                    {task.identifier}
                  </span>
                ) : null}
                {task.name}
              </h1>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <TaskStatusBadge
                  status={task.status}
                  label={tStatus(task.status)}
                  className="w-fit rounded-sm"
                />
                <span className="min-w-0 wrap-anywhere">
                  {task.project?.name ?? t("noProject")}
                </span>
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
                ? removeSeoTaskRequest(
                    removeTaskContextAttachmentLinks(task.description),
                  )
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

/**
 * One archived Task, read-only, so people can check it before restoring. The
 * back link shows at once; the Task fills in below it.
 */
export default function ArchivedTaskPage({ params }: ArchivedTaskPageProps) {
  return (
    <Suspense fallback={<ArchivedTaskLoading />}>
      <ArchivedTaskContent params={params} />
    </Suspense>
  );
}
