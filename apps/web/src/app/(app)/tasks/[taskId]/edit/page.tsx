import { TaskStatus } from "@sokosumi/database";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { TaskEditModal } from "@/app/tasks/components/task-edit-modal";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

export const metadata: Metadata = {
  title: "Edit Task",
};

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const taskResult = await taskService.getTaskById(taskId);

  if (!taskResult) {
    return notFound();
  }

  if (
    taskResult.status !== TaskStatus.DRAFT &&
    taskResult.status !== TaskStatus.READY
  ) {
    redirect(`/tasks/${taskId}`);
  }

  const activeOrganizationId =
    (await getSession())?.session.activeOrganizationId ?? null;
  const targetOrganizationId = taskResult.workspace.organizationId ?? null;

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

  const [taskCoworkers, agents] = await Promise.all([
    coworkerService.listCoworkers("tasks"),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);

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
        uploadingFile: getTaskAttachmentUploadLabelTemplate(
          tEdit,
          "uploadingFile",
        ),
        uploadingFiles: getTaskAttachmentUploadLabelTemplate(
          tEdit,
          "uploadingFiles",
        ),
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
