"use client";

import { type TaskSchedule, TaskScheduleState } from "@sokosumi/core-client";
import {
  Copy,
  Ellipsis,
  FolderInput,
  Pause,
  Pencil,
  Play,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  changeTaskScheduleState,
  deleteTaskSchedule,
  runTaskScheduleNow,
  type TaskScheduleActionError,
} from "@/lib/actions/task-schedule/action";
import type { TaskScheduleStateAction } from "@/lib/clients/core.shared";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskScheduleCopyProjectPicker } from "./task-schedule-copy-project-picker";
import { TaskScheduleDialog } from "./task-schedule-dialog";

interface TaskScheduleActionsProps {
  schedule: TaskSchedule;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  canCreatePrivate: boolean;
  /**
   * Delete of a schedule with no Owner. Organization owner or admin only;
   * everyone else keeps pause, resume, end, and edit.
   */
  canDeleteUnowned?: boolean;
  onChanged?: () => void;
  /**
   * Runs inside the transition of a pause or resume, before the request, so
   * the owner of `schedule` can show the new state at once.
   */
  onStateChanging?: (action: ScheduleToggleAction) => void;
}

export type ScheduleToggleAction = Exclude<TaskScheduleStateAction, "end">;

const STATE_ACTION_TOAST = {
  pause: "paused",
  resume: "resumed",
  end: "ended",
} as const satisfies Record<TaskScheduleStateAction, string>;

/**
 * Edit, copy (in place or to another Project), run now, pause, resume, end,
 * and delete, for whoever Core says may change the schedule (`canWrite`). An
 * Ended schedule is final: it can only be deleted, or copied into a new
 * schedule.
 */
export function TaskScheduleActions({
  schedule,
  coworkerOptions,
  projectOptions,
  canCreatePrivate,
  canDeleteUnowned = false,
  onChanged,
  onStateChanging,
}: TaskScheduleActionsProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const tActions = useTranslations("App.Tasks.Schedules.Actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  // "pick" asks for the destination Project first; then the form opens there.
  // A picked Project may be past the capped `projectOptions`; it rides along
  // so the form can still name it.
  const [copy, setCopy] = useState<
    "pick" | { projectId: string | null; project?: ProjectFilterOption } | null
  >(null);
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const isEnded = schedule.state === TaskScheduleState.ENDED;
  const canDelete = schedule.ownerId !== null || canDeleteUnowned;

  function refreshAfterChange() {
    // The schedule actions revalidate, so their response already carries the
    // page. A parent that keeps extra client state resets it in `onChanged`.
    onChanged?.();
  }

  function reportError(error: TaskScheduleActionError) {
    toast.error(
      error.kind === "stale" ? t("Dialog.errors.stale") : tActions("failed"),
    );
  }

  function handleStateAction(action: TaskScheduleStateAction) {
    startTransition(async () => {
      // End is not shown early: its dialog stays open until the answer.
      if (action !== "end") onStateChanging?.(action);
      const result = await changeTaskScheduleState({
        scheduleId: schedule.id,
        action,
      });
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      toast.success(tActions(STATE_ACTION_TOAST[action]));
      setConfirming(null);
      refreshAfterChange();
    });
  }

  function handleRunNow() {
    startTransition(async () => {
      const result = await runTaskScheduleNow({
        scheduleId: schedule.id,
        expectedRevision: schedule.revision,
      });
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      const { taskId } = result.value;
      toast.success(tActions("ranNow"), {
        duration: Infinity,
        closeButton: true,
        action: {
          label: tActions("openTask"),
          onClick: () => router.push(`/tasks/${taskId}`),
        },
      });
      refreshAfterChange();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTaskSchedule({ scheduleId: schedule.id });
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      toast.success(tActions("deleted"));
      if (onChanged) onChanged();
      else router.push(TASK_SCHEDULES_PATH);
    });
  }

  const isActive = schedule.state === TaskScheduleState.ACTIVE;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {isEnded ? null : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunNow}
            disabled={isPending}
          >
            <Zap aria-hidden />
            {tActions("runNow")}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 md:size-8"
                aria-label={tActions(isActive ? "pause" : "resume")}
                onClick={() => handleStateAction(isActive ? "pause" : "resume")}
                disabled={isPending}
              >
                {isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {tActions(isActive ? "pause" : "resume")}
            </TooltipContent>
          </Tooltip>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-8"
            aria-label={tActions("more")}
            disabled={isPending}
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {isEnded ? null : (
            <>
              <DropdownMenuItem onSelect={() => setIsEditOpen(true)}>
                <Pencil aria-hidden />
                {tActions("edit")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem
            onSelect={() => setCopy({ projectId: schedule.projectId })}
          >
            <Copy aria-hidden />
            {tActions("copy")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCopy("pick")}>
            <FolderInput aria-hidden />
            {tActions("copyToProject")}
          </DropdownMenuItem>
          {isEnded ? null : (
            <DropdownMenuItem onSelect={() => setConfirming("end")}>
              <Square aria-hidden />
              {tActions("end")}
            </DropdownMenuItem>
          )}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirming("delete")}
              >
                <Trash2 aria-hidden />
                {tActions("delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "delete"
                ? tActions("confirmDeleteTitle")
                : tActions("confirmEndTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "delete"
                ? tActions("confirmDeleteDescription")
                : tActions("confirmEndDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={isPending}
              onClick={(event) => {
                // Stay open until the action lands, so a failure is visible.
                event.preventDefault();
                if (confirming === "delete") {
                  handleDelete();
                } else {
                  handleStateAction("end");
                }
              }}
            >
              {confirming === "delete"
                ? tActions("confirmDelete")
                : tActions("confirmEnd")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isEditOpen ? (
        <TaskScheduleDialog
          schedule={schedule}
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          canCreatePrivate={canCreatePrivate}
          onClose={() => setIsEditOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
      {copy === "pick" ? (
        <TaskScheduleCopyProjectPicker
          currentProjectId={schedule.projectId}
          onSelect={(project) => setCopy({ projectId: project.id, project })}
          onClose={() => setCopy(null)}
        />
      ) : copy ? (
        <TaskScheduleDialog
          copyOf={{ ...schedule, projectId: copy.projectId }}
          coworkerOptions={coworkerOptions}
          projectOptions={
            copy.project &&
            !projectOptions.some((option) => option.id === copy.projectId)
              ? [copy.project, ...projectOptions]
              : projectOptions
          }
          canCreatePrivate={canCreatePrivate}
          onClose={() => setCopy(null)}
          onSaved={(scheduleId) =>
            router.push(`${TASK_SCHEDULES_PATH}/${scheduleId}`)
          }
        />
      ) : null}
    </div>
  );
}
