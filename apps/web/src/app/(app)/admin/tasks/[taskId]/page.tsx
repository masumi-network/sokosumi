import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/lib/auth/utils";
import { adminTaskService } from "@/lib/services/admin-task.service";
import { userService } from "@/lib/services/user.service";
import { canOpenAdminTaskAsUser } from "@/lib/utils/admin-task-open";

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
  const [task, session, members, t, formatter] = await Promise.all([
    adminTaskService.getTask(taskId),
    getSession(),
    userService.getMyMembersWithOrganizations(),
    getTranslations("App.Admin.Tasks.TaskDetail"),
    getFormatter(),
  ]);

  if (!task) {
    notFound();
  }

  const canOpen = canOpenAdminTaskAsUser({
    taskUserId: task.user.id,
    taskOrganizationId: task.organization?.id ?? null,
    sessionUserId: session?.user.id ?? null,
    memberOrganizationIds: members.map((member) => member.organizationId),
  });

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{task.name}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/tasks">{t("backToList")}</Link>
            </Button>
            {canOpen ? (
              <Button asChild>
                <Link href={`/tasks/${task.id}`}>{t("open")}</Link>
              </Button>
            ) : (
              <Button disabled>{t("open")}</Button>
            )}
          </div>
        </div>

        {!canOpen && (
          <p className="text-muted-foreground text-sm">
            {t("openUnavailable")}
          </p>
        )}

        <Card>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("taskId")}
                </dt>
                <dd className="text-sm break-all">{task.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("status")}
                </dt>
                <dd className="text-sm">
                  <TaskStatusBadge status={task.status} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("user")}
                </dt>
                <dd className="text-sm">
                  {task.user.name}
                  <span className="text-muted-foreground block text-xs">
                    {task.user.email}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("organization")}
                </dt>
                <dd className="text-sm">
                  {task.organization?.name ?? t("personalWorkspace")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("created")}
                </dt>
                <dd className="text-sm">
                  {formatter.dateTime(task.createdAt, { dateStyle: "medium" })}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
