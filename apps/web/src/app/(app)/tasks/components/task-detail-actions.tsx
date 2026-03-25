"use client";

import { type MemberWithOrganization, TaskStatus } from "@sokosumi/database";
import { ArrowLeftRight, Loader2, Pencil, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteTask, setTaskStatusFromDrag } from "@/lib/actions/task/action";

import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";

interface TaskDetailActionsLabels {
  edit: string;
  delete: string;
  confirmDelete: string;
  confirmDeleteDescription: string;
  deleteError: string;
  markAsReady: string;
  revertToDraft: string;
  cancelRequest: string;
}

interface TaskDetailActionsProps {
  taskId: string;
  status: TaskStatus;
  labels: TaskDetailActionsLabels;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
}

export function TaskDetailActions({
  taskId,
  status,
  labels,
  currentOrganizationId,
  organizations,
}: TaskDetailActionsProps) {
  const t = useTranslations("App");
  const router = useRouter();
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [pendingStatusTarget, setPendingStatusTarget] =
    useState<TaskStatus | null>(null);

  const statusActions = getTaskStatusActions(status, labels);
  const canEditOrDelete =
    status === TaskStatus.DRAFT || status === TaskStatus.READY;
  const isFinalized =
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.CANCEL_REQUESTED;
  const canMove = !isFinalized && organizations && organizations.length > 0;

  const handleStatusToggle = (desiredStatus: TaskStatus) => {
    setPendingStatusTarget(desiredStatus);

    startStatusTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId,
          desiredStatus,
        });
        router.refresh();
        toast.success(t("Tasks.Detail.actions.updateStatusSuccess"));
      } catch (error) {
        console.error("Failed to update task status", error);
        toast.error(t("Tasks.Errors.updateStatus"));
      } finally {
        setPendingStatusTarget(null);
      }
    });
  };

  const handleDelete = () => {
    startDeleteTransition(async () => {
      try {
        await deleteTask({ taskId });
        setIsOpen(false);
        router.push("/tasks");
      } catch (error) {
        console.error("Failed to delete task", error);
        toast.error(labels.deleteError);
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      {statusActions.map((action) => (
        <Button
          key={action.target}
          variant="outline"
          size="sm"
          onClick={() => handleStatusToggle(action.target)}
          disabled={isStatusPending}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          {isStatusPending && pendingStatusTarget === action.target ? (
            <Loader2 className="size-3 animate-spin" />
          ) : null}
          <span>{action.label}</span>
        </Button>
      ))}
      {canEditOrDelete ? (
        <>
          <Link
            href={`/tasks/${taskId}/edit`}
            aria-disabled={isStatusPending}
            tabIndex={isStatusPending ? -1 : 0}
            className={`inline-flex items-center ${isStatusPending ? "pointer-events-none opacity-70" : ""}`}
          >
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={isStatusPending}
              tabIndex={-1}
            >
              <span className="flex items-center gap-1">
                <Pencil className="size-3" aria-hidden />
                <span>{labels.edit}</span>
              </span>
            </Button>
          </Link>
          <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-xs"
                disabled={isDeletePending || isStatusPending}
              >
                <Trash className="size-3" aria-hidden />
                <span>{labels.delete}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{labels.confirmDelete}</AlertDialogTitle>
                <AlertDialogDescription>
                  {labels.confirmDeleteDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletePending}>
                  {t("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeletePending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {labels.delete}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
      {canMove ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 gap-1 px-2 text-xs"
            disabled={isStatusPending || isDeletePending}
            onClick={() => setIsMoveOpen(true)}
          >
            <ArrowLeftRight className="size-3" aria-hidden />
            <span>{t("Tasks.Detail.actions.moveToWorkspace")}</span>
          </Button>
          <MoveTaskToWorkspaceDialog
            open={isMoveOpen}
            onOpenChange={setIsMoveOpen}
            taskId={taskId}
            currentOrganizationId={currentOrganizationId ?? null}
            organizations={organizations}
          />
        </>
      ) : null}
    </div>
  );
}

function getTaskStatusActions(
  status: TaskStatus,
  labels: TaskDetailActionsLabels,
) {
  if (status === TaskStatus.CANCELED) {
    return [
      { label: labels.revertToDraft, target: TaskStatus.DRAFT },
      { label: labels.markAsReady, target: TaskStatus.READY },
    ];
  }

  if (status === TaskStatus.DRAFT) {
    return [{ label: labels.markAsReady, target: TaskStatus.READY }];
  }

  if (status === TaskStatus.READY) {
    return [{ label: labels.revertToDraft, target: TaskStatus.DRAFT }];
  }

  if (
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.AUTHENTICATION_REQUIRED ||
    status === TaskStatus.OUT_OF_CREDITS ||
    status === TaskStatus.CREDITS_TOPPED_UP ||
    status === TaskStatus.RUNNING
  ) {
    return [
      {
        label: labels.cancelRequest,
        target: TaskStatus.CANCEL_REQUESTED,
      },
    ];
  }

  return [];
}
