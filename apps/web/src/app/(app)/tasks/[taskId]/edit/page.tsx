import { TaskStatus } from "@sokosumi/database";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskForm } from "@/app/tasks/components/task-form";
import { agentService } from "@/lib/services";
import { orchestratorService } from "@/lib/services/orchestrator.service";
import { taskService } from "@/lib/services/task.service";

export const metadata = {
  title: "Edit Task",
};

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [taskResult, agents, orchestrators] = await Promise.all([
    taskService.getTaskById(taskId),
    agentService.getAvailableAgents(),
    orchestratorService.listOrchestrators(),
  ]);

  if (!taskResult) {
    return notFound();
  }

  if (
    taskResult.status !== TaskStatus.DRAFT &&
    taskResult.status !== TaskStatus.READY
  ) {
    redirect(`/tasks/${taskId}`);
  }

  const orchestratorOptions = orchestrators.map((orchestrator) => ({
    id: orchestrator.id,
    name: orchestrator.name,
    image: orchestrator.image ?? "",
  }));

  const t = await getTranslations("App.Tasks.EditTask");

  return (
    <div className="w-full max-w-3xl space-y-6 px-2">
      <TaskForm
        mode="edit"
        taskId={taskId}
        labels={{
          pageTitle: t("title"),
          details: t("details"),
          detailsDescription: t("detailsDescription"),
          name: t("name"),
          namePlaceholder: t("namePlaceholder"),
          descriptionPlaceholder: t("descriptionPlaceholder"),
          orchestrator: t("orchestrator"),
          orchestratorDescription: t("orchestratorDescription"),
          status: t("status"),
          statusDescription: t("statusDescription"),
          statusDraft: t("statusDraft"),
          statusReady: t("statusReady"),
          back: t("back"),
          uploadFile: t("uploadFile"),
          submit: t("save"),
          cancel: t("cancel"),
          ctrl: t("ctrl"),
        }}
        orchestratorOptions={orchestratorOptions}
        agents={agents}
        initialValues={{
          name: taskResult.name,
          description: taskResult.description ?? "",
          orchestratorId: taskResult.orchestratorId ?? "",
          status: taskResult.status,
        }}
      />
    </div>
  );
}
