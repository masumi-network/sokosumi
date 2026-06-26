import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { getSession } from "@/lib/auth/auth.server";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  const taskWorkspace = await taskService.getTaskWorkspace(taskId);

  if (!taskWorkspace) {
    return notFound();
  }

  const activeOrganizationId =
    (await getSession())?.session.activeOrganizationId ?? null;
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

    return (
      <AutoContextSwitch
        activeOrganizationId={activeOrganizationId}
        targetOrganizationId={targetOrganizationId}
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

  return <TaskDetailView task={task} enableAutoSwitch />;
}
