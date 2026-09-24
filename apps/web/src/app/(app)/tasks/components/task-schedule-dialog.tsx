"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import { taskScheduleAssigneeId } from "@/app/tasks/utils/task-schedule-view";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { TaskScheduleSection } from "@/components/task-schedule-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createTaskSchedule,
  type TaskScheduleActionError,
  type TaskScheduleBlueprintInput,
  updateTaskSchedule,
} from "@/lib/actions/task-schedule/action";
import {
  type TaskSchedule,
  TaskVisibility,
} from "@/lib/clients/generated/core";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import {
  hasTaskScheduleChanged,
  selectionToTaskScheduleRule,
  taskScheduleRuleToSelection,
} from "@/lib/utils/task-schedule";
import { MarkdownEditor } from "./markdown-editor";
import { TaskAssigneePicker } from "./task-assignee-picker";
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
    // A private schedule cannot assign a member. Drop that assignee rather
    // than saving the private Task's name and description as a public one.
    if (
      !schedule &&
      canCreatePrivate &&
      blueprint.visibility === TaskVisibility.PRIVATE &&
      blueprint.assigneeUserId &&
      assigneeId === blueprint.assigneeUserId
    ) {
      return "";
    }
    return assigneeId;
  });
  const [isPrivate, setIsPrivate] = useState(
    blueprint.visibility === TaskVisibility.PRIVATE,
  );
  const [isSaving, setIsSaving] = useState(false);
  const initialSelection = useMemo<TaskScheduleSelection>(
    () =>
      schedule
        ? taskScheduleRuleToSelection(schedule.rule)
        : {
            mode: "recurring",
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
  // Core refuses a person on a private schedule, as it does on a private Task:
  // while private, members cannot be picked; while a member is picked, the
  // schedule cannot be made private.
  const showPrivateControl =
    !schedule && canCreatePrivate && assignee.assigneeUserId === null;
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

  async function handleSave(selection: TaskScheduleSelection) {
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
            ...(hasTaskScheduleChanged(initialSelection, selection, true)
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
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
            <MarkdownEditor
              id={descriptionId}
              ariaLabel={t("description")}
              value={description}
              onChange={setDescription}
              placeholder={tNewTask("descriptionPlaceholder")}
            />
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
                isOptionDisabled={(option) =>
                  isPrivateSchedule &&
                  option !== "unassigned" &&
                  option.kind === "user"
                }
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
              hideHeader
              recurringOnly
              initialSelection={initialSelection}
              saveLabel={schedule ? t("save") : t("create")}
              saveDisabled={isSaving || !name.trim()}
              onSave={(selection) => void handleSave(selection)}
              onCancel={onClose}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
