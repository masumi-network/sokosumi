import type { TaskStatus } from "@sokosumi/core-client";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { TaskEditModal } from "@/app/tasks/components/task-edit-modal";
import type {
  TaskFormInitialDesignMdAttachment,
  TaskFormLabels,
} from "@/app/tasks/components/task-form";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import {
  taskFormAssigneeId,
  withCurrentTaskAssigneeOption,
} from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import { isTaskEditPageAllowed } from "@/app/tasks/utils/task-edit-eligibility";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services/agent.service";
import { designMdService } from "@/lib/services/design-md.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { resolveAccountName } from "@/lib/utils/account-name";

interface TaskEditWorkspaceSwitch {
  kind: "switch-workspace";
  activeOrganizationId: string | null;
  targetOrganizationId: string | null;
  successMessage: string;
}

interface TaskEditReady {
  kind: "edit";
  taskId: string;
  title: string;
  initialDesignMdAttachment: TaskFormInitialDesignMdAttachment | null;
  labels: TaskFormLabels;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  agentNameById: Map<string, string>;
  initialValues: {
    name: string;
    description: string;
    assigneeId: string;
    assigneeSokoBotId: string | null;
    assigneeUserId: string | null;
    projectId: string | null;
    status: TaskStatus;
    selectableStatuses: readonly TaskStatus[];
    runAt: string | null;
  };
}

export type LoadTaskEditResult = TaskEditWorkspaceSwitch | TaskEditReady;

export async function loadTaskEdit(
  taskId: string,
): Promise<LoadTaskEditResult> {
  const taskResult = await taskService.getTaskById(taskId);

  if (!taskResult) {
    return notFound();
  }

  if (!isTaskEditPageAllowed(taskResult)) {
    redirect(`/tasks/${taskId}`);
  }

  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
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

    return {
      kind: "switch-workspace",
      activeOrganizationId,
      targetOrganizationId,
      successMessage: tDetail("switchedWorkspace", {
        account: targetAccountName,
      }),
    };
  }

  const [coworkerOptions, agents, projectOptions, initialDesignMdAttachment] =
    await Promise.all([
      listTaskAssigneeOptions(targetOrganizationId),
      agentService.getAvailableAgentsWithCreditsPrice(),
      getProjectFilterOptions(taskResult.projectId ?? null),
      session?.user?.id
        ? designMdService.resolveEffectiveDesignMd()
        : Promise.resolve(null),
    ]);
  const agentNameById = buildAgentNameById(agents);

  const [tEdit, tStatus, tTasks] = await Promise.all([
    getTranslations("App.Tasks.EditTask"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getTranslations("App.Tasks"),
  ]);

  return {
    kind: "edit",
    // Mutations (PATCH) need the uuid; GET alone resolves identifier refs.
    taskId: taskResult.id,
    title: tEdit("title"),
    initialDesignMdAttachment,
    labels: {
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
      unassigned: tEdit("unassigned"),
      unavailableAssignee: tEdit("unavailableAssignee"),
      changeCoworker: tEdit("changeCoworker"),
      noCoworkerMatches: tEdit("noCoworkerMatches"),
      status: tEdit("status"),
      statusDescription: tEdit("statusDescription"),
      statusDraft: tEdit("statusDraft"),
      changeStatus: tEdit("changeStatus"),
      noStatusMatches: tEdit("noStatusMatches"),
      statusReady: tEdit("statusReady"),
      statusQueued: tStatus("QUEUED"),
      untitledTask: tEdit("untitledTask"),
      saveError: tEdit("saveError"),
      statusLabels: buildTaskStatusLabels((key) => tStatus(key)),
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
      openRunAt: tEdit("openRunAt"),
      cancel: tEdit("cancel"),
      ctrl: tEdit("ctrl"),
    },
    coworkerOptions: withCurrentTaskAssigneeOption(
      coworkerOptions,
      taskResult.assignee,
      {
        fallbackName: tTasks("sokoBot"),
        vendorName: tTasks("sokoBots"),
      },
    ),
    projectOptions,
    agentNameById,
    initialValues: {
      name: taskResult.name,
      description: taskResult.description ?? "",
      assigneeId: taskFormAssigneeId(taskResult),
      assigneeSokoBotId: taskResult.assigneeSokoBotId ?? null,
      assigneeUserId: taskResult.assigneeUserId ?? null,
      projectId: taskResult.projectId ?? null,
      status: taskResult.status,
      selectableStatuses: taskResult.selectableStatuses,
      runAt: taskResult.runAt?.toISOString() ?? null,
    },
  };
}

export function TaskEditView({ result }: { result: LoadTaskEditResult }) {
  switch (result.kind) {
    case "switch-workspace": {
      const { kind: _kind, ...switchProps } = result;
      return <AutoContextSwitch {...switchProps} />;
    }
    case "edit": {
      const { kind: _kind, ...editProps } = result;
      return <TaskEditModal {...editProps} />;
    }
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
