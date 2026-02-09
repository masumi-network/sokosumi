import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [taskResult, coworkers, agents, session, t] = await Promise.all([
    taskService.getTaskById(taskId),
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    getSession(),
    getTranslations("App.Tasks.Detail"),
  ]);

  if (!taskResult) {
    return notFound();
  }

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentNameById = new Map<string, string>();
  for (const agent of agents) {
    agentNameById.set(agent.id, agent.name);
  }
  const task = mapTaskToTaskWithCoworker(taskResult, coworkersById, agentsById);
  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "User",
        image: session.user.image ?? null,
      }
    : null;
  const userById = currentUser ? { [currentUser.id]: currentUser } : undefined;
  const coworkerById = Object.fromEntries(
    coworkers.map((coworker) => [
      coworker.id,
      {
        name: coworker.name,
        image: coworker.image ?? null,
      },
    ]),
  );

  return (
    <div className="min-h-full w-full md:pr-60">
      {/* Centered content */}
      <div className="mx-auto max-w-4xl px-4">
        {session?.user.id ? (
          <TaskStatusRealtimeListener
            userId={session.user.id}
            taskId={taskId}
          />
        ) : null}
        <TaskDetailHeader
          task={task}
          labels={{
            back: t("back"),
            actions: {
              edit: t("actions.edit"),
              delete: t("actions.delete"),
              confirmDelete: t("actions.confirmDelete"),
              confirmDeleteDescription: t("actions.confirmDeleteDescription"),
              deleteError: t("actions.deleteError"),
              markAsReady: t("actions.markAsReady"),
              revertToDraft: t("actions.revertToDraft"),
            },
          }}
        />

        <div className="mt-6 space-y-8">
          <TaskDescription
            title={t("description")}
            description={task.description}
            agentNameById={agentNameById}
            expandLabel={t("expand")}
            collapseLabel={t("collapse")}
          />

          <TaskActivitySection
            taskId={taskId}
            title={t("activity")}
            placeholder={t("commentPlaceholder")}
            attachLabel={t("attach")}
            submitLabel={t("submit")}
            actorCoworkerLabel={t("actorCoworker")}
            actorUserLabel={t("actorUser")}
            actorSystemLabel={t("actorSystem")}
            actionCommentedLabel={t("actionCommented")}
            actionUpdatedStatusLabel={t("actionUpdatedStatus")}
            events={task.events}
            agentNameById={agentNameById}
            userById={userById}
            coworkerById={coworkerById}
            currentUser={currentUser}
            expandLabel={t("expand")}
            collapseLabel={t("collapse")}
          />
        </div>

        {/* Mobile properties */}
        <div className="mt-6 md:hidden">
          <TaskMetadata
            task={task}
            labels={{
              propertiesTitle: t("properties"),
              status: t("status"),
              coworker: t("coworker"),
              created: t("created"),
              updated: t("updated"),
            }}
          />
        </div>
      </div>

      {/* Properties sidebar - fixed on right edge as a panel */}
      <aside className="border-border bg-background fixed top-16 right-0 bottom-0 hidden w-60 overflow-y-auto border-l md:block">
        <div className="px-6 py-5">
          <TaskMetadata
            task={task}
            labels={{
              propertiesTitle: t("properties"),
              status: t("status"),
              coworker: t("coworker"),
              created: t("created"),
              updated: t("updated"),
            }}
          />
        </div>
      </aside>
    </div>
  );
}
