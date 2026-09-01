import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { TaskForm } from "@/app/tasks/components/task-form";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/list-task-assignee-member-options";
import { taskAssigneeFormLabels } from "@/app/tasks/utils/task-assignee-form-labels";
import { getSession } from "@/lib/auth/auth.server";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { hasAssignedOrganizationSeat } from "@/lib/services/organization-assigned-seat.service";

export const metadata = {
  title: "New Task",
};

export default async function NewTaskPage() {
  const t = await getTranslations("App.Tasks.NewTask");
  const [taskCoworkers, agents, session, memberOptions] = await Promise.all([
    coworkerService.listCoworkers("tasks").catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
    getSession(),
    listTaskAssigneeMemberOptions(),
  ]);
  const initialDesignMdAttachment = session?.user?.id
    ? await designMdService.resolveEffectiveDesignMd()
    : null;
  const coworkerOptions = getCoworkerOptions(taskCoworkers);
  const canCreateTask = await hasAssignedOrganizationSeat(
    session?.session.activeOrganizationId ?? null,
  );
  if (!canCreateTask) {
    redirect("/tasks");
  }
  const agentNameById = buildAgentNameById(agents);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-6 px-4">
        <TaskForm
          mode="create"
          labels={{
            details: t("details"),
            detailsDescription: t("detailsDescription"),
            name: t("name"),
            namePlaceholder: t("namePlaceholder"),
            descriptionPlaceholder: t("descriptionPlaceholder"),
            projectLabel: t("projectLabel"),
            projectNone: t("projectNone"),
            projectSearchPlaceholder: t("projectSearchPlaceholder"),
            projectEmptyResults: t("projectEmptyResults"),
            coworker: t("coworker"),
            coworkerDescription: t("coworkerDescription"),
            ...taskAssigneeFormLabels(t),
            status: t("status"),
            statusDescription: t("statusDescription"),
            statusDraft: t("statusDraft"),
            statusQueued: t("statusQueued"),
            statusReady: t("statusReady"),
            back: t("back"),
            uploadFile: t("uploadFile"),
            uploadFileError: t("uploadFileError"),
            uploadingFile: getTaskAttachmentUploadLabelTemplate(
              t,
              "uploadingFile",
            ),
            uploadingFiles: getTaskAttachmentUploadLabelTemplate(
              t,
              "uploadingFiles",
            ),
            removeAttachment: t("removeAttachment"),
            submit: t("saveDraft"),
            saveAsDraft: t("saveAsDraft"),
            createTask: t("createTask"),
            scheduleTask: t("scheduleTask"),
            openSchedule: t("openSchedule"),
            cancel: t("cancel"),
            ctrl: t("ctrl"),
          }}
          coworkerOptions={coworkerOptions}
          memberOptions={memberOptions}
          currentUserId={session?.user?.id ?? null}
          agentNameById={agentNameById}
          initialDesignMdAttachment={initialDesignMdAttachment}
        />
      </div>
    </div>
  );
}
