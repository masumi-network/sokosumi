"use client";

import { type MemberWithOrganization, TaskStatus } from "@sokosumi/database";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Ellipsis,
  Loader2,
  Pencil,
  RotateCcw,
  Trash,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTask, setTaskStatusFromDrag } from "@/lib/actions/task/action";

import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";
import { getWorkspaceMoveTargetCount } from "./workspace-move-targets";

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
  jobsCount: number;
  actionsMenuLabel: string;
  labels: TaskDetailActionsLabels;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel: string;
}

export function TaskDetailActions({
  taskId,
  status,
  jobsCount,
  actionsMenuLabel,
  labels,
  currentOrganizationId,
  organizations,
  personalWorkspaceLabel,
}: TaskDetailActionsProps) {
  const tApp = useTranslations("App");
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const tTasks = useTranslations("App.Tasks");
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
  const canMove =
    !isFinalized &&
    jobsCount === 0 &&
    getWorkspaceMoveTargetCount(currentOrganizationId, organizations) > 0;

  const handleStatusToggle = (desiredStatus: TaskStatus) => {
    setPendingStatusTarget(desiredStatus);

    startStatusTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId,
          desiredStatus,
        });
        router.refresh();
        toast.success(tDetailActions("updateStatusSuccess"));
      } catch (error) {
        console.error("Failed to update task status", error);
        toast.error(tTasks("Errors.updateStatus"));
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

  const actionsDisabled = isStatusPending || isDeletePending;

  return (
    <>
      <div className="hidden items-center gap-1.5 md:flex">
        {statusActions.map((action) => {
          const StatusIcon = getStatusActionMenuIcon(action.target);

          return (
            <Button
              key={action.target}
              variant="outline"
              size="sm"
              onClick={() => handleStatusToggle(action.target)}
              disabled={isStatusPending}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              {isStatusPending && pendingStatusTarget === action.target ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <StatusIcon className="size-3" aria-hidden />
              )}
              <span>{action.label}</span>
            </Button>
          );
        })}
        {canEditOrDelete ? (
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
        ) : null}
        {canMove ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 gap-1 px-2 text-xs"
            disabled={actionsDisabled}
            onClick={() => setIsMoveOpen(true)}
          >
            <ArrowLeftRight className="size-3" aria-hidden />
            <span>{tDetailActions("moveToWorkspace")}</span>
          </Button>
        ) : null}
        {canEditOrDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-xs"
            disabled={isDeletePending || isStatusPending}
            onClick={() => setIsOpen(true)}
          >
            <Trash className="size-3" aria-hidden />
            <span>{labels.delete}</span>
          </Button>
        ) : null}
      </div>

      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label={actionsMenuLabel}
              disabled={actionsDisabled}
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {statusActions.map((action) => {
              const StatusIcon = getStatusActionMenuIcon(action.target);

              return (
                <DropdownMenuItem
                  key={action.target}
                  disabled={isStatusPending}
                  onSelect={() => handleStatusToggle(action.target)}
                >
                  {isStatusPending && pendingStatusTarget === action.target ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <StatusIcon className="size-4" aria-hidden />
                  )}
                  <span>{action.label}</span>
                </DropdownMenuItem>
              );
            })}
            {canEditOrDelete ? (
              <DropdownMenuItem asChild disabled={isStatusPending}>
                <Link
                  href={`/tasks/${taskId}/edit`}
                  className={
                    isStatusPending ? "pointer-events-none opacity-70" : ""
                  }
                >
                  <Pencil className="size-4" aria-hidden />
                  {labels.edit}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canMove ? (
              <DropdownMenuItem
                disabled={actionsDisabled}
                onSelect={() => setIsMoveOpen(true)}
              >
                <ArrowLeftRight className="size-4" aria-hidden />
                {tDetailActions("moveToWorkspace")}
              </DropdownMenuItem>
            ) : null}
            {canEditOrDelete ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={isDeletePending || isStatusPending}
                onSelect={() => setIsOpen(true)}
              >
                <Trash className="size-4" aria-hidden />
                {labels.delete}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {canEditOrDelete ? (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.confirmDelete}</AlertDialogTitle>
              <AlertDialogDescription>
                {labels.confirmDeleteDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletePending}>
                {tApp("cancel")}
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
      ) : null}

      {canMove ? (
        <MoveTaskToWorkspaceDialog
          open={isMoveOpen}
          onOpenChange={setIsMoveOpen}
          taskId={taskId}
          currentOrganizationId={currentOrganizationId ?? null}
          organizations={organizations ?? []}
          personalWorkspaceLabel={personalWorkspaceLabel}
        />
      ) : null}
    </>
  );
}

/** Icons for status transitions in the mobile overflow menu (aligned with action meaning). */
function getStatusActionMenuIcon(target: TaskStatus): LucideIcon {
  switch (target) {
    case TaskStatus.DRAFT:
      return RotateCcw;
    case TaskStatus.READY:
      return CheckCircle2;
    case TaskStatus.CANCEL_REQUESTED:
      return Ban;
    default:
      return CheckCircle2;
  }
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
