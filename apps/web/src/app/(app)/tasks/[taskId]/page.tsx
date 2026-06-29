import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { TaskWorkspaceSwitchDialog } from "@/app/tasks/components/task-workspace-switch-dialog";
import { getSession } from "@/lib/auth/auth.server";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import {
  resolveAccountName,
  resolveOrganization,
} from "@/lib/utils/account-name";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  const [taskWorkspace, session] = await Promise.all([
    taskService.getTaskWorkspace(taskId),
    getSession(),
  ]);

  if (!taskWorkspace) {
    return notFound();
  }

  if (!session) {
    return notFound();
  }

  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const targetOrganizationId = taskWorkspace.organizationId ?? null;

  if (activeOrganizationId !== targetOrganizationId) {
    const [members, tDetail, tOrganizationSwitcher] = await Promise.all([
      userService.getMyMembersWithOrganizations(),
      getTranslations("App.Tasks.Detail"),
      getTranslations("Components.OrganizationSwitcher"),
    ]);
    const targetAccountName = resolveAccountName(
      targetOrganizationId,
      members,
      tOrganizationSwitcher("personalAccount"),
    );
    const currentAccountName = resolveAccountName(
      activeOrganizationId,
      members,
      tOrganizationSwitcher("personalAccount"),
    );

    return (
      <TaskWorkspaceSwitchDialog
        currentAccountName={currentAccountName}
        currentOrganization={resolveOrganization(activeOrganizationId, members)}
        sessionUser={session.user}
        taskName={taskWorkspace.name}
        targetOrganization={resolveOrganization(targetOrganizationId, members)}
        targetOrganizationId={targetOrganizationId}
        targetAccountName={targetAccountName}
        successMessage={tDetail("switchedWorkspace", {
          account: targetAccountName,
        })}
      />
    );
  }

  const task = await taskService.getTaskById(taskId);

  if (!task) {
    return notFound();
  }

  return <TaskDetailView task={task} />;
}
