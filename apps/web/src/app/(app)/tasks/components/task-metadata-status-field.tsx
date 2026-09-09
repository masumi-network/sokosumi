"use client";

import { userTaskStatusTransitionRequiresComment } from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskStatusBadge } from "./task-status-badge";

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
  labels: TaskMetadataStatusFieldLabels;
}

export function TaskMetadataStatusField({
  taskId,
  status,
  labels,
}: TaskMetadataStatusFieldProps) {
  const router = useRouter();
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenComment, setReopenComment] = useState("");

  function applyStatusChange(desiredStatus: TaskStatus, comment?: string) {
    setPendingStatus(desiredStatus);

    startTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus,
          comment,
        });
        if (!result.ok) {
          setCurrentStatus(status);
          showCalendarClientUpgradeModal();
          return;
        }
        setCurrentStatus(desiredStatus);
        router.refresh();
        toast.success(labels.updateStatusSuccess);
      } catch (error) {
        console.error("Failed to update task status", error);
        setCurrentStatus(status);
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

    setCurrentStatus(nextStatus);
    applyStatusChange(nextStatus);
  }

  function handleReopenConfirm() {
    const trimmedComment = reopenComment.trim();
    if (!trimmedComment) {
      toast.error(labels.reopenToReadyCommentRequired);
      return;
    }

    setCurrentStatus(TaskStatus.READY);
    setIsReopenDialogOpen(false);
    applyStatusChange(TaskStatus.READY, trimmedComment);
    setReopenComment("");
  }

  const displayStatus =
    isPending && pendingStatus ? pendingStatus : currentStatus;

  return (
    <>
      <Select
        value={displayStatus}
        onValueChange={(value) => handleStatusSelect(value as TaskStatus)}
        disabled={isPending}
      >
        <SelectTrigger
          aria-label={labels.statusLabels[displayStatus]}
          className="h-auto w-auto min-w-[8rem] border-0 bg-transparent p-0 shadow-none focus:ring-0"
        >
          <SelectValue>
            <span className="inline-flex items-center gap-2">
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              <TaskStatusBadge
                status={displayStatus}
                label={labels.statusLabels[displayStatus]}
                showLabel
              />
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {TASK_STATUS_DISPLAY_ORDER.map((option) => (
            <SelectItem key={option} value={option}>
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
