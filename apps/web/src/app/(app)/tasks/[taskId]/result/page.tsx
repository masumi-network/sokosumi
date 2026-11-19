import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { seoAuditHref, seoProjectHref } from "@/app/seo/seo-href";
import { getPrivateCachedSession } from "@/lib/auth/auth.server";
import { taskService } from "@/lib/services/task.service";
import { taskWorkspaceAfterMiss } from "../_lib/task-workspace-after-miss";
import { OpenTaskResult } from "./open-task-result";

export default async function TaskResultPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  // A saved notification can outlive the audit or the reader's access.
  await connection();
  const { taskId } = await params;
  const task = await taskService.getTaskById(taskId);
  if (!task)
    return taskWorkspaceAfterMiss(taskId, await getPrivateCachedSession());
  const result = task.status === "COMPLETED" ? task.seoAudit : null;
  if (!result?.auditId && !result?.projectId) {
    redirect(`/tasks/${encodeURIComponent(task.id)}`);
  }
  const t = await getTranslations("App.Tasks.Detail");
  const href = result.auditId
    ? seoAuditHref(result.auditId, result.projectId)
    : seoProjectHref(result.projectId!);
  return (
    <OpenTaskResult
      taskId={task.id}
      href={href}
      label={t(result.auditId ? "openSeoAudit" : "openSeoProjectWorkspace")}
    />
  );
}
