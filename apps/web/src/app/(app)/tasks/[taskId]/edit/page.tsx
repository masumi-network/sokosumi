import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { TaskEditModal } from "@/app/tasks/components/task-edit-modal";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { buildPaAssigneeOption } from "@/app/tasks/utils/pa-assignee-option";
import { isTaskEditPageAllowed } from "@/app/tasks/utils/task-edit-eligibility";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import type { Project } from "@/lib/clients/generated/core";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";

export const metadata: Metadata = {
  title: "Edit Task",
};

const PROJECT_FILTER_OPTIONS_LIMIT = 100;

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

  if (!isTaskEditPageAllowed(taskResult)) {
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

  const [taskCoworkers, agents, projectsPage, sokoBot] = await Promise.all([
    coworkerService.listCoworkers("tasks").catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
    projectService.listProjects({ limit: PROJECT_FILTER_OPTIONS_LIMIT }),
    sokoBotService.getMine().catch(() => null),
  ]);

  const coworkerOptions = getCoworkerOptions(taskCoworkers);
  const paAssigneeOption = buildPaAssigneeOption(sokoBot);
  const projectOptions = await buildProjectOptions(
    projectsPage.projects,
    taskResult.projectId ?? null,
  );
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
        projectLabel: tEdit("projectLabel"),
        projectNone: tEdit("projectNone"),
        projectSearchPlaceholder: tEdit("projectSearchPlaceholder"),
        projectEmptyResults: tEdit("projectEmptyResults"),
        projectCreate: tEdit("projectCreate"),
        projectCreateNamed: tEdit.raw("projectCreateNamed") as string,
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
        openSchedule: tEdit("openSchedule"),
        cancel: tEdit("cancel"),
        ctrl: tEdit("ctrl"),
      }}
      coworkerOptions={coworkerOptions}
      paAssigneeOption={paAssigneeOption}
      projectOptions={projectOptions}
      agentNameById={agentNameById}
      initialValues={{
        name: taskResult.name,
        description: taskResult.description ?? "",
        assigneeId: taskResult.assigneeId ?? "",
        assigneeOrchestratorId: taskResult.assigneeOrchestratorId ?? null,
        projectId: taskResult.projectId ?? null,
        status: taskResult.status,
        metadata: taskResult.metadata,
        nextRunAt: taskResult.nextRunAt?.toISOString() ?? null,
      }}
    />
  );
}

async function buildProjectOptions(
  projects: Project[],
  selectedProjectId: string | null,
): Promise<ProjectFilterOption[]> {
  const projectOptions = projects.map((project) => ({
    id: project.id,
    name: project.name,
    logo: project.logo,
    designMd: project.designMd,
    briefingUrl: project.briefingUrl,
    contextMd: project.contextMd,
  }));

  if (
    !selectedProjectId ||
    projectOptions.some((project) => project.id === selectedProjectId)
  ) {
    return projectOptions;
  }

  const selectedProject =
    await projectService.getProjectById(selectedProjectId);
  if (!selectedProject) {
    return projectOptions;
  }

  return [
    {
      id: selectedProject.id,
      name: selectedProject.name,
      logo: selectedProject.logo,
      designMd: selectedProject.designMd,
      briefingUrl: selectedProject.briefingUrl,
      contextMd: selectedProject.contextMd,
    },
    ...projectOptions,
  ];
}
