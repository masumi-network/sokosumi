import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { Button } from "@/components/ui/button";
import { developerTaskService } from "@/lib/services/developer-task.service";

export const metadata: Metadata = {
  title: "Task",
  description: "Developer task detail",
};

interface DeveloperTaskDetailPageProps {
  params: Promise<{ taskId: string }>;
}

export default async function DeveloperTaskDetailPage({
  params,
}: DeveloperTaskDetailPageProps) {
  const { taskId } = await params;
  const [taskDetail, t] = await Promise.all([
    developerTaskService.getTask(taskId),
    getTranslations("App.Developer.Tasks.TaskDetail"),
  ]);

  if (!taskDetail) {
    notFound();
  }

  const { task, owner, organization } = taskDetail;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 pt-2">
        <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="text-sm">
            <span className="font-medium">{owner.name}</span>
            <span className="text-muted-foreground"> · {owner.email}</span>
            <span className="text-muted-foreground">
              {" · "}
              {organization?.name ?? t("personalWorkspace")}
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/developer/tasks">{t("backToList")}</Link>
          </Button>
        </div>
      </div>

      <TaskDetailView task={task} forceReadOnly />
    </div>
  );
}
