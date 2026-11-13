"use client";

import { TaskStatus } from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";

import { useOptimisticTaskStatus } from "./task-detail-optimistic";
import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskStatusPicker } from "./task-status-picker";

export interface TaskMetadataStatusFieldLabels {
  /** Field name, prefixed to the trigger's accessible name: "Status: Running". */
  status: string;
  statusLabels: Record<TaskStatus, string>;
  changeStatus: string;
  noStatusMatches: string;
  reopenToReadyTitle: string;
  reopenToReadyDescription: string;
  reopenToReadyCommentLabel: string;
  reopenToReadyCommentPlaceholder: string;
  reopenToReadyCommentRequired: string;
  reopenToReadyConfirm: string;
  cancel: string;
  updateStatusSuccess: string;
  updateStatusError: string;
}

interface TaskMetadataStatusFieldProps {
  taskId: string;
  status: TaskStatus;
  /** Statuses Core lets this viewer move the Task to (ADR 0029). */
  selectableStatuses: readonly TaskStatus[];
  labels: TaskMetadataStatusFieldLabels;
}

export function TaskMetadataStatusField({
  taskId,
  status,
  selectableStatuses,
  labels,
}: TaskMetadataStatusFieldProps) {
  const router = useRouter();
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const [currentStatus, showStatus, isStatusChanging] =
    useOptimisticTaskStatus(status);
  const [isPending, startTransition] = useTransition();
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenComment, setReopenComment] = useState("");

  function applyStatusChange(desiredStatus: TaskStatus, comment?: string) {
    startTransition(async () => {
      // Shown here and in the header menu until the write has its answer.
      showStatus(desiredStatus);
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus,
          comment,
        });
        if (!result.ok) {
          if (
            result.error.kind === CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE
          ) {
            // The offered list went stale (assignee or schedule changed
            // elsewhere); refresh so the picker shows what Core allows now.
            toast.error(labels.updateStatusError);
            router.refresh();
            return;
          }
          showCalendarClientUpgradeModal();
          return;
        }
        toast.success(labels.updateStatusSuccess);
      } catch (error) {
        console.error("Failed to update task status", error);
        toast.error(labels.updateStatusError);
      }
    });
  }

  function handleStatusSelect(nextStatus: TaskStatus) {
    if (nextStatus === currentStatus) return;

    if (userTaskStatusTransitionRequiresComment(currentStatus, nextStatus)) {
      setReopenComment("");
      setIsReopenDialogOpen(true);
      return;
    }

    applyStatusChange(nextStatus);
  }

  function handleReopenConfirm() {
    const trimmedComment = reopenComment.trim();
    if (!trimmedComment) {
      toast.error(labels.reopenToReadyCommentRequired);
      return;
    }

    setIsReopenDialogOpen(false);
    applyStatusChange(TaskStatus.READY, trimmedComment);
    setReopenComment("");
  }

  return (
    <>
      <TaskStatusPicker
        value={currentStatus}
        options={selectableStatuses}
        labels={{
          statusLabels: labels.statusLabels,
          ariaLabel: `${labels.status}: ${labels.statusLabels[currentStatus]}`,
          searchPlaceholder: labels.changeStatus,
          noResults: labels.noStatusMatches,
        }}
        onSelect={handleStatusSelect}
        // Also while the header menu changes the status: a pick now would
        // be judged against a status Core has not confirmed.
        isPending={isPending || isStatusChanging}
        openShortcutKey="s"
        align="start"
        variant="row"
      />

      <TaskReopenToReadyDialog
        open={isReopenDialogOpen}
        onOpenChange={(open) => {
          setIsReopenDialogOpen(open);
          if (!open) {
            setReopenComment("");
          }
        }}
        labels={{
          title: labels.reopenToReadyTitle,
          description: labels.reopenToReadyDescription,
          commentLabel: labels.reopenToReadyCommentLabel,
          commentPlaceholder: labels.reopenToReadyCommentPlaceholder,
          confirm: labels.reopenToReadyConfirm,
          cancel: labels.cancel,
        }}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={handleReopenConfirm}
        isPending={isPending && currentStatus === TaskStatus.READY}
      />
    </>
  );
}
