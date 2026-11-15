import type { useTranslations } from "next-intl";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import type { TaskFormLabels } from "./task-form";

/** Labels of the New Task form that the task detail menu opens. */
export function buildNewTaskFormLabels(
  tNewTask: ReturnType<typeof useTranslations<"App.Tasks.NewTask">>,
): TaskFormLabels {
  return {
    details: tNewTask("details"),
    detailsDescription: tNewTask("detailsDescription"),
    name: tNewTask("name"),
    namePlaceholder: tNewTask("namePlaceholder"),
    descriptionPlaceholder: tNewTask("descriptionPlaceholder"),
    projectLabel: tNewTask("projectLabel"),
    projectNone: tNewTask("projectNone"),
    projectSearchPlaceholder: tNewTask("projectSearchPlaceholder"),
    projectEmptyResults: tNewTask("projectEmptyResults"),
    coworker: tNewTask("coworker"),
    unassigned: tNewTask("unassigned"),
    unavailableAssignee: tNewTask("unavailableAssignee"),
    changeCoworker: tNewTask("changeCoworker"),
    noCoworkerMatches: tNewTask("noCoworkerMatches"),
    status: tNewTask("status"),
    statusDescription: tNewTask("statusDescription"),
    statusDraft: tNewTask("statusDraft"),
    changeStatus: tNewTask("changeStatus"),
    noStatusMatches: tNewTask("noStatusMatches"),
    statusQueued: tNewTask("statusQueued"),
    statusReady: tNewTask("statusReady"),
    untitledTask: tNewTask("untitledTask"),
    saveError: tNewTask("saveError"),
    back: tNewTask("back"),
    uploadFile: tNewTask("uploadFile"),
    uploadFileError: tNewTask("uploadFileError"),
    uploadingFile: getTaskAttachmentUploadLabelTemplate(
      tNewTask,
      "uploadingFile",
    ),
    uploadingFiles: getTaskAttachmentUploadLabelTemplate(
      tNewTask,
      "uploadingFiles",
    ),
    removeAttachment: tNewTask("removeAttachment"),
    submit: tNewTask("createTask"),
    createTask: tNewTask("createTask"),
    scheduleTask: tNewTask("scheduleTask"),
    openRunAt: tNewTask("openRunAt"),
    cancel: tNewTask("cancel"),
    ctrl: tNewTask("ctrl"),
    privateLabel: tNewTask("privateLabel"),
    privateDescription: tNewTask("privateDescription"),
  };
}
