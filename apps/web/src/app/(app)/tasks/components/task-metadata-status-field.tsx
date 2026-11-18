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
import { TaskStatusAge } from "./task-status-age";
import { TaskStatusPicker } from "./task-status-picker";

export interface TaskMetadataStatusFieldLabels {
  /** Field name, prefixed to the trigger's accessible name: "Status: Running". */
  status: string;
  statusLabels: Record<TaskStatus, string>;
  changeStatus: string;
  noStatusMatches: string;
  reopenToReadyCommentRequired: string;
  updateStatusSuccess: string;
  updateStatusError: string;
}

interface TaskMetadataStatusFieldProps {
  taskId: string;
  status: TaskStatus;
  /** Statuses Core lets this viewer move the Task to (ADR 0029). */
  selectableStatuses: readonly TaskStatus[];
  /** ISO time the saved status began. */
  statusSince?: string;
  /** The Coworker or Soko Bot assigned, or null for a person's Task. */
  agentAssigneeName: string | null;
  labels: TaskMetadataStatusFieldLabels;
}

export function TaskMetadataStatusField({
  taskId,
  status,
  selectableStatuses,
  statusSince,
  agentAssigneeName,
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

    if (
      userTaskStatusTransitionRequiresComment(
        currentStatus,
        nextStatus,
        agentAssigneeName !== null,
      )
    ) {
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

  function handleReopenAsDraft() {
    setIsReopenDialogOpen(false);
    applyStatusChange(TaskStatus.DRAFT);
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
      {statusSince ? (
        <TaskStatusAge
          status={currentStatus}
          // A status shown before Core confirms it starts its clock now.
          statusSince={
            isStatusChanging ? new Date().toISOString() : statusSince
          }
          variant="row"
        />
      ) : null}

      <TaskReopenToReadyDialog
        open={isReopenDialogOpen}
        onOpenChange={(open) => {
          setIsReopenDialogOpen(open);
          if (!open) {
            setReopenComment("");
          }
        }}
        assigneeName={agentAssigneeName ?? ""}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={handleReopenConfirm}
        // Only a finished Task reopens; an Input Required one is still running.
        onReopenAsDraft={
          currentStatus === TaskStatus.COMPLETED ||
          currentStatus === TaskStatus.CANCELED
            ? handleReopenAsDraft
            : undefined
        }
        isPending={isPending && currentStatus === TaskStatus.READY}
      />
    </>
  );
}
