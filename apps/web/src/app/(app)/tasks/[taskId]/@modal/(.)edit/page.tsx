import { TaskStatus } from "@sokosumi/database";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TaskEditModal } from "@/app/tasks/components/task-edit-modal";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

export default async function TaskEditModalPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [taskResult, taskCoworkers, agents] = await Promise.all([
    taskService.getTaskById(taskId),
    coworkerService.listCoworkers("tasks"),
    agentService.getAvailableAgentsWithCreditsPrice(),
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

  const coworkerOptions = getCoworkerOptions(taskCoworkers);
  const agentNameById = buildAgentNameById(agents);

  const [tEdit, tActions] = await Promise.all([
    getTranslations("App.Tasks.EditTask"),
    getTranslations("App.Tasks.Detail.actions"),
  ]);

  return (
    <TaskEditModal
      taskId={taskId}
      title={tEdit("title")}
      labels={{
        details: tEdit("details"),
        detailsDescription: tEdit("detailsDescription"),
        name: tEdit("name"),
        namePlaceholder: tEdit("namePlaceholder"),
        descriptionPlaceholder: tEdit("descriptionPlaceholder"),
        coworker: tEdit("coworker"),
        coworkerDescription: tEdit("coworkerDescription"),
        status: tEdit("status"),
        statusDescription: tEdit("statusDescription"),
        statusDraft: tEdit("statusDraft"),
        statusReady: tEdit("statusReady"),
        markAsReady: tActions("markAsReady"),
        revertToDraft: tActions("revertToDraft"),
        back: tEdit("back"),
        uploadFile: tEdit("uploadFile"),
        uploadFileError: tEdit("uploadFileError"),
        removeAttachment: tEdit("removeAttachment"),
        submit: tEdit("save"),
        cancel: tEdit("cancel"),
        ctrl: tEdit("ctrl"),
      }}
      coworkerOptions={coworkerOptions}
      agentNameById={agentNameById}
      initialValues={{
        name: taskResult.name,
        description: taskResult.description ?? "",
        coworkerId: taskResult.coworkerId ?? "",
        status: taskResult.status,
      }}
    />
  );
}
