import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProjectScopeMarker } from "@/app/components/project-scope/project-scope-marker";
import { loadWorkspaceSwitchAccounts } from "@/app/components/user-avatar/workspace-switch-accounts";
import { TaskCanonicalUrl } from "@/app/tasks/components/task-canonical-url";
import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { TaskWorkspaceSwitchDialog } from "@/app/tasks/components/task-workspace-switch-dialog";
import { taskHref } from "@/app/tasks/utils/task-href";
import { MarkNotificationsRead } from "@/components/notifications/mark-notifications-read.client";
import { getSession } from "@/lib/auth/auth.server";
import { taskService } from "@/lib/services/task.service";
import { isUuidString } from "@/lib/utils/uuid";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  // Uuid, `SOK-12`, or `SOK-12-some-slug`: Core resolves all three.
  await connection();
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
    return (
      <>
        <TaskDetailView task={task} />
        <TaskCanonicalUrl href={taskHref(task)} />
        {/* Opening the task is reading what its notifications were about.
            Not on the admin or developer views: those inspect someone else's
            task rather than act on it. */}
        <MarkNotificationsRead kind="TASK" referenceId={task.id} />
        <ProjectScopeMarker projectId={task.projectId ?? null} />
      </>
    );
  }

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
