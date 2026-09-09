"use client";

import { userTaskStatusTransitionRequiresComment } from "@sokosumi/utils";
import { ChevronDown, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { getTaskStatusPillTone } from "./task-status-badge";

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
  const pillTone = getTaskStatusPillTone(displayStatus);

  return (
    <>
      <Select
        value={displayStatus}
        onValueChange={(value) => handleStatusSelect(value as TaskStatus)}
        disabled={isPending}
      >
        <SelectTrigger
          aria-label={displayLabel}
          className={cn(
            "h-auto w-auto gap-0 border-0 bg-transparent p-0 shadow-none",
            "dark:bg-transparent dark:hover:bg-transparent",
            "focus-visible:border-transparent focus-visible:ring-0",
            "data-[size=default]:h-auto",
            "[&>svg]:hidden",
          )}
        >
          <SelectValue>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium leading-none",
                pillTone.bg,
                pillTone.text,
              )}
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : null}
              <span>{displayLabel}</span>
              <ChevronDown className="size-3 opacity-70" aria-hidden />
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
