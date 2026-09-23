"use client";

import { Pause, Pencil, Play, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
  changeTaskScheduleState,
  deleteTaskSchedule,
  type TaskScheduleActionError,
} from "@/lib/actions/task-schedule/action";
import {
  type TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import type { TaskScheduleStateAction } from "@/lib/services/task-schedule.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskScheduleDialog } from "./task-schedule-dialog";

interface TaskScheduleActionsProps {
  schedule: TaskSchedule;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  canCreatePrivate: boolean;
}

const STATE_ACTION_TOAST = {
  pause: "paused",
  resume: "resumed",
  end: "ended",
} as const satisfies Record<TaskScheduleStateAction, string>;

/**
 * Edit, pause, resume, end, and delete for the schedule's owner. An Ended
 * schedule is final: it can only be deleted.
 */
export function TaskScheduleActions({
  schedule,
  coworkerOptions,
  projectOptions,
  canCreatePrivate,
}: TaskScheduleActionsProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const tActions = useTranslations("App.Tasks.Schedules.Actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const isEnded = schedule.state === TaskScheduleState.ENDED;

  function reportError(error: TaskScheduleActionError) {
    toast.error(
      error.kind === "stale" ? t("Dialog.errors.stale") : tActions("failed"),
    );
  }

  function handleStateAction(action: TaskScheduleStateAction) {
    startTransition(async () => {
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
      router.refresh();
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
      router.push("/tasks?tab=schedules");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isEnded ? null : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditOpen(true)}
            disabled={isPending}
          >
            <Pencil className="size-4" aria-hidden />
            {tActions("edit")}
          </Button>
          {schedule.state === TaskScheduleState.ACTIVE ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStateAction("pause")}
              disabled={isPending}
            >
              <Pause className="size-4" aria-hidden />
              {tActions("pause")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStateAction("resume")}
              disabled={isPending}
            >
              <Play className="size-4" aria-hidden />
              {tActions("resume")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming("end")}
            disabled={isPending}
          >
            <Square className="size-4" aria-hidden />
            {tActions("end")}
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirming("delete")}
        disabled={isPending}
      >
        <Trash2 className="size-4" aria-hidden />
        {tActions("delete")}
      </Button>

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
              disabled={isPending}
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
        />
      ) : null}
    </div>
  );
}
