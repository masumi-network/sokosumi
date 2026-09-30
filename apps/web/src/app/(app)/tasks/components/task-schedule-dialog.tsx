"use client";

import { type TaskSchedule, TaskVisibility } from "@sokosumi/core-client";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import { taskScheduleAssigneeId } from "@/app/tasks/utils/task-schedule-view";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { TaskScheduleSection } from "@/components/task-schedule-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  createTaskSchedule,
  type TaskScheduleActionError,
  type TaskScheduleBlueprintInput,
  updateTaskSchedule,
} from "@/lib/actions/task-schedule/action";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  extractTaskAttachmentUrls,
  removeTaskAttachmentLinks,
} from "@/lib/utils/task-attachments";
import {
  hasTaskScheduleChanged,
  selectionToTaskScheduleRule,
  taskScheduleRuleToSelection,
} from "@/lib/utils/task-schedule";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { TaskAssigneePicker } from "./task-assignee-picker";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import { TaskProjectSelect } from "./task-project-select";

/** What a new schedule starts from, such as the Task behind "Repeat". */
export type TaskScheduleBlueprintPrefill = Partial<
  TaskScheduleBlueprintInput & { visibility: TaskVisibility }
>;

interface TaskScheduleDialogProps {
  /** Edits this schedule; without it the dialog creates one. */
  schedule?: TaskSchedule;
  initialBlueprint?: TaskScheduleBlueprintPrefill;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  /** Private schedules exist only in organization workspaces. */
  canCreatePrivate: boolean;
  onClose: () => void;
  onSaved?: (scheduleId: string) => void;
}

const NEW_SCHEDULE_CRON = "0 9 * * *";

/**
 * Creates or edits a Task Schedule: the blueprint of the Task each Run
 * creates, and the rule. Mount it only while open, so every opening starts
 * from the props.
 */
export function TaskScheduleDialog({
  schedule,
  initialBlueprint,
  coworkerOptions,
  projectOptions,
  canCreatePrivate,
  onClose,
  onSaved,
}: TaskScheduleDialogProps) {
  const t = useTranslations("App.Tasks.Schedules.Dialog");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const router = useRouter();
  const nameId = useId();
  const descriptionId = useId();
  const privateId = useId();
  const blueprint = schedule ?? initialBlueprint ?? {};
  const [name, setName] = useState(blueprint.name ?? "");
  const [description, setDescription] = useState(blueprint.description ?? "");
  const [projectId, setProjectId] = useState<string | null>(
    blueprint.projectId ?? null,
  );
  const [assigneeValue, setAssigneeValue] = useState(() => {
    const assigneeId = taskScheduleAssigneeId(blueprint) ?? "";
    // A legacy member assignee is cleared when editing or repeating a Task.
    if (blueprint.assigneeUserId && assigneeId === blueprint.assigneeUserId) {
      return "";
    }
    return assigneeId;
  });
  const [isPrivate, setIsPrivate] = useState(
    blueprint.visibility === TaskVisibility.PRIVATE,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const attachmentUrls = extractTaskAttachmentUrls(description);
  useMountEffect(() => () => uploadControllerRef.current?.abort());
  const initialSelection = useMemo<TaskScheduleSelection>(
    () =>
      schedule
        ? taskScheduleRuleToSelection(schedule.rule)
        : {
            timezone: getDefaultTimezone(),
            cron: NEW_SCHEDULE_CRON,
          },
    [schedule],
  );

  const assignee = resolveTaskAssigneeFields(
    assigneeValue,
    coworkerOptions,
    blueprint.assigneeSokoBotId,
    blueprint.assigneeUserId,
  );
  const showPrivateControl = !schedule && canCreatePrivate;
  const isPrivateSchedule = schedule
    ? schedule.visibility === TaskVisibility.PRIVATE
    : showPrivateControl && isPrivate;

  function reportError(error: TaskScheduleActionError) {
    if (error.kind === "stale") {
      toast.error(t("errors.stale"));
      return;
    }
    toast.error(t("errors.saveFailed"), { description: error.message });
  }

  async function handleAttachFiles(files: File[]) {
    if (files.length === 0 || uploadControllerRef.current || isSaving) return;

    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setIsUploadingAttachments(true);
    try {
      const uploaded = await uploadComposeAttachments(files, {
        abortSignal: controller.signal,
        labels: {
          uploadingFile: getTaskAttachmentUploadLabelTemplate(
            tNewTask,
            "uploadingFile",
          ),
          uploadingFiles: getTaskAttachmentUploadLabelTemplate(
            tNewTask,
            "uploadingFiles",
          ),
          uploadError: tNewTask("uploadFileError"),
        },
      });
      if (controller.signal.aborted || !markdownEditorRef.current) return;
      for (const file of uploaded) {
        markdownEditorRef.current.insertLink(file.fileName, file.publicUrl);
        markdownEditorRef.current.insertText("\n");
      }
    } catch {
      // The shared uploader reports errors and allows another attempt.
    } finally {
      uploadControllerRef.current = null;
      if (!controller.signal.aborted) {
        setPendingUploadFiles([]);
        setIsUploadingAttachments(false);
      }
    }
  }

  async function handleSave(selection: TaskScheduleSelection) {
    if (isSaving || uploadControllerRef.current) return;
    const rule = selectionToTaskScheduleRule(selection);
    const trimmedName = name.trim();
    if (!rule || !trimmedName) return;

    const input: TaskScheduleBlueprintInput = {
      name: trimmedName,
      description: description.trim() || null,
      projectId,
      ...assignee,
    };
    setIsSaving(true);
    try {
      const result = schedule
        ? await updateTaskSchedule({
            ...input,
            scheduleId: schedule.id,
            expectedRevision: schedule.revision,
            // Replacing the rule drops skipped and moved Runs, so an edit
            // that leaves it alone does not send it.
            ...(hasTaskScheduleChanged(initialSelection, selection)
              ? { rule }
              : {}),
          })
        : await createTaskSchedule({
            ...input,
            visibility: isPrivateSchedule
              ? TaskVisibility.PRIVATE
              : TaskVisibility.PUBLIC,
            rule,
          });
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      toast.success(schedule ? t("saved") : t("created"));
      router.refresh();
      onSaved?.(result.value.scheduleId);
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent className="app-scrollbar max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {schedule ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>
            {schedule ? t("futureOnlyNotice") : t("createDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t("name")}</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={tNewTask("namePlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={descriptionId}>{t("description")}</Label>
            <FileUpload
              label={tNewTask("uploadFile")}
              value={pendingUploadFiles}
              onValueChange={setPendingUploadFiles}
              onAccept={(files) => void handleAttachFiles(files)}
              disabled={isSaving || isUploadingAttachments}
              multiple
            >
              <FileUploadDropzone
                className="data-dragging:bg-card-background items-stretch border-0 p-0 hover:bg-transparent"
                tabIndex={-1}
                onClick={(event) => event.preventDefault()}
              >
                <MarkdownEditor
                  ref={markdownEditorRef}
                  id={descriptionId}
                  ariaLabel={t("description")}
                  value={description}
                  onChange={setDescription}
                  placeholder={tNewTask("descriptionPlaceholder")}
                  onAttachClick={() => attachmentTriggerRef.current?.click()}
                  attachLabel={tNewTask("uploadFile")}
                  isAttachmentUploading={isUploadingAttachments}
                />
                <FileUploadTrigger asChild>
                  <button
                    ref={attachmentTriggerRef}
                    type="button"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                  />
                </FileUploadTrigger>
              </FileUploadDropzone>
            </FileUpload>
            {attachmentUrls.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachmentUrls.map((url) => (
                  <FileChipMiniPreviewWithMetadata
                    key={url}
                    url={url}
                    sizeClass="size-16"
                    onRemove={() =>
                      setDescription((current) =>
                        removeTaskAttachmentLinks(current, [url]),
                      )
                    }
                    removeLabel={tNewTask("removeAttachment")}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("assignee")}</Label>
              <TaskAssigneePicker
                value={assigneeValue}
                options={coworkerOptions}
                labels={{
                  ariaLabel: t("assignee"),
                  unassigned: tNewTask("unassigned"),
                  unavailableAssignee: tNewTask("unavailableAssignee"),
                  searchPlaceholder: tNewTask("changeCoworker"),
                  noResults: tNewTask("noCoworkerMatches"),
                  agentsGroupLabel: tNewTask("coworker"),
                }}
                onSelect={setAssigneeValue}
              />
            </div>
            <div className="space-y-2">
              <Label>{tNewTask("projectLabel")}</Label>
              <TaskProjectSelect
                projectOptions={projectOptions}
                value={projectId}
                onChange={setProjectId}
                projectLabel={tNewTask("projectLabel")}
                noneLabel={tNewTask("projectNone")}
                searchPlaceholder={tNewTask("projectSearchPlaceholder")}
                emptyResults={tNewTask("projectEmptyResults")}
              />
            </div>
          </div>
          {showPrivateControl ? (
            <div className="flex items-start gap-3">
              <Switch
                id={privateId}
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
              />
              <div className="space-y-1">
                <Label htmlFor={privateId} className="gap-1.5">
                  <Lock className="size-3.5" aria-hidden />
                  {tNewTask("privateLabel")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {tNewTask("privateDescription")}
                </p>
              </div>
            </div>
          ) : null}

          <div className="border-t pt-4">
            <TaskScheduleSection
              initialSelection={initialSelection}
              saveLabel={schedule ? t("save") : t("create")}
              saveDisabled={isSaving || isUploadingAttachments || !name.trim()}
              onSave={(selection) => void handleSave(selection)}
              onCancel={onClose}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
