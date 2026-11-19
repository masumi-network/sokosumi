import { notFound } from "next/navigation";
import { loadWorkspaceSwitchAccounts } from "@/app/components/user-avatar/workspace-switch-accounts";
import { TaskWorkspaceSwitchDialog } from "@/app/tasks/components/task-workspace-switch-dialog";
import type { getPrivateCachedSession } from "@/lib/auth/auth.server";
import { taskService } from "@/lib/services/task.service";
import { isUuidString } from "@/lib/utils/uuid";

export async function taskWorkspaceAfterMiss(
  taskId: string,
  session: Awaited<ReturnType<typeof getPrivateCachedSession>>,
) {
  if (!session) return notFound();
  // The workspace probe maps ids only. An identifier ref that missed the
  // active workspace has nothing to switch to, so it is a plain 404.
  if (!isUuidString(taskId)) {
    return notFound();
  }

  const taskWorkspace = await taskService.getTaskWorkspace(taskId);

  if (!taskWorkspace) {
    return notFound();
  }

  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const targetOrganizationId = taskWorkspace.organizationId ?? null;

  // Same workspace but task read failed — real miss, not a switch case.
  if (activeOrganizationId === targetOrganizationId) {
    return notFound();
  }

  return (
    <TaskWorkspaceSwitchDialog
      {...(await loadWorkspaceSwitchAccounts(session, targetOrganizationId))}
      taskName={taskWorkspace.name}
    />
  );
}
