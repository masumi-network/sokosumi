import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { orchestratorService } from "@/lib/services/orchestrator.service";
import { taskService } from "@/lib/services/task.service";
import { mapTaskToTaskWithOrchestrator } from "@/lib/utils/task-transformer";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [taskResult, orchestrators, agents] = await Promise.all([
    taskService.getTaskById(taskId),
    orchestratorService.listOrchestrators(),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);

  if (!taskResult) {
    return notFound();
  }

  const orchestratorsById = new Map(
    orchestrators.map((orchestrator) => [orchestrator.id, orchestrator]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentNameById = new Map<string, string>();
  for (const agent of agents) {
    agentNameById.set(agent.id, agent.name);
  }
  const task = mapTaskToTaskWithOrchestrator(
    taskResult,
    orchestratorsById,
    agentsById,
  );
  const session = await getSession();
  const userById = new Map<string, { name: string; image: string | null }>();
  if (session?.user) {
    userById.set(session.user.id, {
      name: session.user.name ?? "User",
      image: session.user.image ?? null,
    });
  }
  const orchestratorById = new Map<
    string,
    { name: string; image: string | null }
  >(
    orchestrators.map((orchestrator) => [
      orchestrator.id,
      {
        name: orchestrator.name,
        image: orchestrator.image ?? null,
      },
    ]),
  );

  const t = await getTranslations("App.Tasks.Detail");
  const tCard = await getTranslations("App.Tasks.Card");

  return (
    <div className="w-full max-w-3xl space-y-6 px-2">
      <TaskDetailHeader
        task={task}
        labels={{
          back: t("back"),
          actions: {
            edit: t("actions.edit"),
            delete: t("actions.delete"),
          },
        }}
      />

      <TaskMetadata
        task={task}
        labels={{
          status: t("status"),
          orchestrator: t("orchestrator"),
        }}
      />

      <TaskDescription
        title={t("description")}
        description={task.description}
        agentNameById={agentNameById}
      />

      <TaskActivitySection
        title={t("activity")}
        placeholder={t("commentPlaceholder")}
        attachLabel={t("attach")}
        submitLabel={t("submit")}
        events={task.events}
        userById={userById}
        orchestratorById={orchestratorById}
      />
    </div>
  );
}
