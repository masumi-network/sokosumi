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

  // Happy path is active-workspace scoped: one Core read. Only probe workspace
  // mapping when that miss might mean "switch workspace" rather than 404.
  const [task, session] = await Promise.all([
    taskService.getTaskById(taskId),
    getSession(),
  ]);

  if (!session) {
    return notFound();
  }

  if (task) {
    return <TaskDetailView task={task} />;
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
