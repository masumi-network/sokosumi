import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProjectScopeMarker } from "@/app/components/project-scope/project-scope-marker";
import { TaskCanonicalUrl } from "@/app/tasks/components/task-canonical-url";
import { TaskDetailStatusProvider } from "@/app/tasks/components/task-detail-optimistic";
import { TaskDetailLinksProvider } from "@/app/tasks/components/task-detail-optimistic-links";
import { TaskDetailView } from "@/app/tasks/components/task-detail-view";
import { getPrivateCachedTask } from "@/app/tasks/utils/private-task-detail-cache";
import { taskHref } from "@/app/tasks/utils/task-href";
import { MarkNotificationsRead } from "@/components/notifications/mark-notifications-read.client";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { getPrivateCachedSession } from "@/lib/auth/auth.server";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";
import { taskWorkspaceAfterMiss } from "./_lib/task-workspace-after-miss";

/**
 * The task's name as the tab title, as plain text like the page heading.
 * Same private-cached read as the page.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ taskId: string }>;
}): Promise<Metadata> {
  const { taskId } = await params;
  const task = await getPrivateCachedTask(taskId).catch(() => null);
  return task ? { title: stripInlineMarkdown(task.name) } : {};
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  // Uuid, `SOK-12`, or `SOK-12-some-slug`: Core resolves all three.
  const { taskId } = await params;

  // Happy path is active-workspace scoped: one Core read. Only probe workspace
  // mapping when that miss might mean "switch workspace" rather than 404.
  // Both reads are private-cached, so a task link's prefetch carries the page.
  const [task, session] = await Promise.all([
    getPrivateCachedTask(taskId).catch(() => null),
    getPrivateCachedSession(),
  ]);

  // A miss can be a passing Core outage, which both reads turn into null. A
  // prefetch must not keep that as a 404 or a switch dialog, so every page
  // but the task itself renders fresh on the click.
  if (!task || !session) {
    await connection();
  }

  if (!session) {
    return notFound();
  }

  if (task) {
    return (
      <>
        <TaskDetailStatusProvider status={task.status}>
          <TaskDetailLinksProvider>
            <TaskDetailView task={task} />
          </TaskDetailLinksProvider>
        </TaskDetailStatusProvider>
        <TaskCanonicalUrl href={taskHref(task)} />
        {/* Opening the task is reading what its notifications were about.
            Not on the admin or developer views: those inspect someone else's
            task rather than act on it. */}
        <MarkNotificationsRead kind="TASK" referenceId={task.id} />
        <ProjectScopeMarker projectId={task.projectId ?? null} />
        <RefreshPrefetchedPage />
      </>
    );
  }

  return taskWorkspaceAfterMiss(taskId, session);
}
