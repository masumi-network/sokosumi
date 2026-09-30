"use client";

import { type TaskSchedule, TaskVisibility } from "@sokosumi/core-client";
import {
  CalendarClock,
  ChevronDown,
  Loader2,
  Lock,
  Paperclip,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import { taskScheduleAssigneeId } from "@/app/tasks/utils/task-schedule-view";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  createTaskSchedule,
  type TaskScheduleActionError,
  type TaskScheduleBlueprintInput,
  updateTaskSchedule,
} from "@/lib/actions/task-schedule/action";
import { DOW, formatWeekday } from "@/lib/schedules/cron";
import {
  type ScheduleWhen,
  selectionToWhen,
  upcomingRuns,
  whenToSelection,
} from "@/lib/schedules/schedule-when";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
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
import { TaskFormModal } from "./task-form-modal";
import { TaskProjectSelect } from "./task-project-select";
import { scheduleChipClass, TaskScheduleWhen } from "./task-schedule-when";

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

/** One plain sentence for when the schedule runs. */
function useWhenSummary(when: ScheduleWhen, selection: TaskScheduleSelection) {
  const t = useTranslations("App.Tasks.Schedules.Dialog.When");
  const formatter = useFormatter();
  const runs = useMemo(() => upcomingRuns(selection, 3), [selection]);
  const time = when.time;
  let rule: string;
  switch (when.repeat) {
    case "daily":
      rule = t("summary.daily", { time });
      break;
    case "weekdays":
      rule = t("summary.weekdays", { time });
      break;
    case "weekly": {
      const days = DOW.filter((day) => when.weekdays.includes(day));
      rule =
        days.length > 0
          ? t("summary.weekly", {
              days: days.map((day) => formatWeekday(day, formatter)).join(", "),
              time,
            })
          : t("summary.incomplete");
      break;
    }
    case "monthly":
      rule = t("summary.monthly", { day: when.dayOfMonth, time });
      break;
    case "interval":
      rule = t("summary.interval", { n: when.intervalDays, time });
      break;
    case "custom":
      rule = t("summary.custom");
      break;
  }
  return {
    rule,
    runs: runs.map((run) =>
      formatter.dateTime(run, "dateTimeMedium", { timeZone: when.timezone }),
    ),
  };
}

/**
 * Creates or edits a Task Schedule: the blueprint of the Task each Run
 * creates, and when it runs. It uses the New Task form's shell, fields and
 * pickers. Mount it only while open, so every opening starts from the props.
 */
export function TaskScheduleDialog(props: TaskScheduleDialogProps) {
  return (
    <TaskScheduleDialogForm
      key={
        props.schedule
          ? `${props.schedule.id}:${props.schedule.revision}`
          : "new"
      }
      {...props}
    />
  );
}

function TaskScheduleDialogForm({
  schedule,
  initialBlueprint,
  coworkerOptions,
  projectOptions,
  canCreatePrivate,
  onClose,
  onSaved,
}: TaskScheduleDialogProps) {
  const t = useTranslations("App.Tasks.Schedules.Dialog");
  const tWhen = useTranslations("App.Tasks.Schedules.Dialog.When");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const router = useRouter();
  const descriptionId = useId();
  const privateDescriptionId = useId();
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
  // Keep the baseline stable for this keyed form's lifetime. Re-reading a
  // stored H cron on a same-revision refresh can select a different minute.
  const [initialSelection] = useState<TaskScheduleSelection>(() =>
    schedule
      ? taskScheduleRuleToSelection(schedule.rule)
      : { timezone: getDefaultTimezone(), cron: NEW_SCHEDULE_CRON },
  );
  const [initialWhen] = useState(() => selectionToWhen(initialSelection));
  const [when, setWhen] = useState<ScheduleWhen>(initialWhen);
  // Until the controls differ from what was read, the rule stays as read: an
  // edit to the blueprint never rewrites a rule the controls only approximate.
  const whenChanged =
    JSON.stringify(whenToSelection(when)) !==
    JSON.stringify(whenToSelection(initialWhen));
  const selection = useMemo(
    () => (whenChanged ? whenToSelection(when) : initialSelection),
    [whenChanged, when, initialSelection],
  );
  const rule = useMemo(
    () => selectionToTaskScheduleRule(selection),
    [selection],
  );
  const summary = useWhenSummary(when, selection);

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
  // An edit that leaves the rule alone does not send it, so a stored rule the
  // controls reject (one from before the five-field cron) still saves.
  const ruleRequired = !schedule || whenChanged;
  const saveDisabled =
    isSaving ||
    isUploadingAttachments ||
    !name.trim() ||
    (ruleRequired && !rule);

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

  async function handleSave() {
    if (saveDisabled || uploadControllerRef.current) return;

    const input: TaskScheduleBlueprintInput = {
      name: name.trim(),
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
            ...(rule && hasTaskScheduleChanged(initialSelection, selection)
              ? { rule }
              : {}),
          })
        : // A create always requires the rule; `rule &&` only narrows it.
          rule &&
          (await createTaskSchedule({
            ...input,
            visibility: isPrivateSchedule
              ? TaskVisibility.PRIVATE
              : TaskVisibility.PUBLIC,
            rule,
          }));
      if (!result) return;
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
    <TaskFormModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={schedule ? t("editTitle") : t("createTitle")}
      cancelLabel={tNewTask("cancel")}
      isDismissDisabled={isSaving}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-4 md:px-8">
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

          <div className="space-y-4 border-t px-6 py-5 md:px-8">
            <input
              type="text"
              aria-label={t("name")}
              placeholder={tNewTask("namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              className="placeholder:text-muted-foreground w-full border-0 bg-transparent px-0 text-xl leading-tight font-semibold tracking-tight shadow-none outline-none"
            />
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
                  variant="document"
                  ariaLabel={t("description")}
                  value={description}
                  onChange={setDescription}
                  placeholder={tNewTask("descriptionPlaceholder")}
                  className="w-full"
                  editorClassName="min-h-32"
                  onSubmitShortcut={() => {
                    if (!saveDisabled) void handleSave();
                  }}
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
            <div className="flex flex-wrap items-center gap-2">
              <AttachmentSubmenu
                onUploadClick={() => attachmentTriggerRef.current?.click()}
                onDriveClick={() =>
                  markdownEditorRef.current?.openDrivePicker()
                }
                disabled={isSaving || isUploadingAttachments}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={tNewTask("uploadFile")}
                  disabled={isSaving || isUploadingAttachments}
                >
                  {isUploadingAttachments ? (
                    <Loader2
                      className="size-3.5 animate-spin motion-reduce:animate-pulse"
                      aria-hidden
                    />
                  ) : (
                    <Paperclip className="size-3.5" aria-hidden />
                  )}
                  {tNewTask("uploadFile")}
                </Button>
              </AttachmentSubmenu>
              <TaskProjectSelect
                variant="chip"
                projectOptions={projectOptions}
                value={projectId}
                onChange={setProjectId}
                projectLabel={tNewTask("projectLabel")}
                noneLabel={tNewTask("projectNone")}
                placeholder={tNewTask("projectPlaceholder")}
                searchPlaceholder={tNewTask("projectSearchPlaceholder")}
                emptyResults={tNewTask("projectEmptyResults")}
              />
              {showPrivateControl ? (
                <>
                  <span id={privateDescriptionId} className="sr-only">
                    {tNewTask("privateDescription")}
                  </span>
                  <HoverCard openDelay={150}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        aria-label={tNewTask("privateLabel")}
                        aria-pressed={isPrivate}
                        aria-describedby={privateDescriptionId}
                        className={cn(
                          scheduleChipClass,
                          isPrivate
                            ? "bg-secondary text-secondary-foreground border-transparent"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                        onClick={() => setIsPrivate((current) => !current)}
                      >
                        <Lock className="size-3.5 shrink-0" aria-hidden />
                        {tNewTask("privateLabel")}
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="top"
                      align="start"
                      className="w-72 text-sm"
                    >
                      <p className="text-muted-foreground">
                        {tNewTask("privateDescription")}
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                </>
              ) : null}
            </div>
          </div>

          <section
            aria-labelledby={`${descriptionId}-when`}
            className="space-y-4 border-t px-6 py-5 md:px-8"
          >
            <div className="space-y-1">
              <h3
                id={`${descriptionId}-when`}
                className="text-sm font-semibold"
              >
                {tWhen("title")}
              </h3>
              <p className="text-muted-foreground text-xs">
                {schedule ? t("futureOnlyNotice") : t("createDescription")}
              </p>
            </div>
            <TaskScheduleWhen
              value={when}
              onChange={setWhen}
              storedCron={schedule?.rule.expr}
            />
          </section>
        </div>

        <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8">
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            <span className="truncate" data-testid="schedule-summary">
              {summary.rule}
              {when.repeat !== "custom" ? ` · ${when.timezone}` : ""}
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  {summary.runs[0]
                    ? tWhen("next", { date: summary.runs[0] })
                    : tWhen("noNext")}
                  {summary.runs.length > 1 ? (
                    <ChevronDown className="size-3.5" aria-hidden />
                  ) : null}
                </button>
              </PopoverTrigger>
              {summary.runs.length > 0 ? (
                <PopoverContent align="start" className="w-64">
                  <p className="text-muted-foreground mb-2 text-xs font-medium">
                    {tWhen("nextRuns")}
                  </p>
                  <ul className="space-y-1 text-sm tabular-nums">
                    {summary.runs.map((run) => (
                      <li key={run}>{run}</li>
                    ))}
                  </ul>
                </PopoverContent>
              ) : null}
            </Popover>
          </div>
          <Button
            type="button"
            className="min-w-28 sm:ml-auto"
            disabled={saveDisabled}
            onClick={() => void handleSave()}
          >
            {isSaving ? (
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-pulse"
                aria-hidden
              />
            ) : null}
            {schedule ? t("save") : t("create")}
          </Button>
        </div>
      </div>
    </TaskFormModal>
  );
}
