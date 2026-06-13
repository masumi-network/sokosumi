import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { Button } from "@/components/ui/button";
import { adminTaskService } from "@/lib/services/admin-task.service";

export const metadata: Metadata = {
  title: "Task",
  description: "Admin task detail",
};

interface AdminTaskDetailPageProps {
  params: Promise<{ taskId: string }>;
}

export default async function AdminTaskDetailPage({
  params,
}: AdminTaskDetailPageProps) {
  const { taskId } = await params;
  const [taskDetail, t] = await Promise.all([
    adminTaskService.getTask(taskId),
    getTranslations("App.Admin.Tasks.TaskDetail"),
  ]);

  if (!taskDetail) {
    notFound();
  }

  const { task, user, organization } = taskDetail;

  return (
    <div className="min-h-full w-full">
      {/* Admin-only context strip: surfaces the owner email (not shown in the
          user-facing view) and the owning workspace, plus a way back to the
          list. The task itself renders read-only below. */}
      <div className="mx-auto max-w-4xl px-4 pt-2">
        <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="text-sm">
            <span className="font-medium">{user.name}</span>
            <span className="text-muted-foreground"> · {user.email}</span>
            <span className="text-muted-foreground">
              {" · "}
              {organization?.name ?? t("personalWorkspace")}
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/tasks">{t("backToList")}</Link>
          </Button>
        </div>
      </div>

      <TaskDetailView task={task} forceReadOnly />
    </div>
  );
}
