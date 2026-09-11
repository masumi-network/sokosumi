"use client";

import { userTaskStatusTransitionRequiresComment } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import { getManualTaskStatusSelectOptions } from "@/lib/utils/task-status-order";

import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskStatusPillSelectTrigger } from "./task-status-pill-select-trigger";

export interface TaskMetadataStatusFieldLabels {
  statusLabels: Record<TaskStatus, string>;
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
  hasSchedule: boolean;
  labels: TaskMetadataStatusFieldLabels;
}

function canSelectQueued(options: { hasSchedule: boolean }): boolean {
  return options.hasSchedule;
}

export function TaskMetadataStatusField({
  taskId,
  status,
  hasSchedule,
  labels,
}: TaskMetadataStatusFieldProps) {
  const router = useRouter();
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenComment, setReopenComment] = useState("");
  const isQueuedSelectable = canSelectQueued({ hasSchedule });

  function applyStatusChange(desiredStatus: TaskStatus, comment?: string) {
    const previousStatus = currentStatus;
    setPendingStatus(desiredStatus);
    setCurrentStatus(desiredStatus);

    startTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus,
          comment,
        });
        if (!result.ok) {
          setCurrentStatus(previousStatus);
          showCalendarClientUpgradeModal();
          return;
        }
        router.refresh();
        toast.success(labels.updateStatusSuccess);
      } catch (error) {
        console.error("Failed to update task status", error);
        setCurrentStatus(previousStatus);
        toast.error(labels.updateStatusError);
      } finally {
        setPendingStatus(null);
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

  const displayStatus =
    isPending && pendingStatus ? pendingStatus : currentStatus;
  const displayLabel = labels.statusLabels[displayStatus];

  return (
    <>
      <Select
        value={displayStatus}
        onValueChange={(value) => handleStatusSelect(value as TaskStatus)}
        disabled={isPending}
      >
        <TaskStatusPillSelectTrigger
          status={displayStatus}
          label={displayLabel}
          ariaLabel={displayLabel}
          isPending={isPending}
        />
        <SelectContent align="end">
          {getManualTaskStatusSelectOptions(displayStatus).map((option) => (
            <SelectItem
              key={option}
              value={option}
              disabled={option === TaskStatus.QUEUED && !isQueuedSelectable}
            >
              {labels.statusLabels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
        isPending={isPending && pendingStatus === TaskStatus.READY}
      />
    </>
  );
}
