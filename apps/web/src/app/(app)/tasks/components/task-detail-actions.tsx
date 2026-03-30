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
  Share,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTask, setTaskStatusFromDrag } from "@/lib/actions/task/action";
import type { TaskShare } from "@/lib/clients/generated/core";

import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";
import { TaskShareButton } from "./task-share-button";
import { TaskShareModal } from "./task-share-modal";
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
  share: string;
}

interface TaskDetailActionsProps {
  taskId: string;
  share: TaskShare | null;
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
  share,
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
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [pendingStatusTarget, setPendingStatusTarget] =
    useState<TaskStatus | null>(null);

  const statusActions = getTaskStatusActions(status, labels);
  const mobilePrimaryStatusAction =
    statusActions.find((action) => action.target === TaskStatus.READY) ??
    statusActions[0] ??
    null;
  const mobileOverflowStatusActions = statusActions.filter(
    (action) => action.target !== mobilePrimaryStatusAction?.target,
  );
  const MobilePrimaryStatusIcon = mobilePrimaryStatusAction
    ? getStatusActionMenuIcon(mobilePrimaryStatusAction.target)
    : CheckCircle2;
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
  const isMobileActionsMenuDisabled = isDeletePending;

  return (
    <>
      <div className="hidden items-center gap-3 md:flex">
        <div
          className="flex items-center gap-1.5"
          data-testid="task-secondary-actions"
        >
          <TaskShareButton
            task={{ id: taskId, share }}
            label={labels.share}
            variant="ghost"
            size="icon"
            className="size-7"
          />
          {canEditOrDelete ? (
            <Link
              href={`/tasks/${taskId}/edit`}
              aria-disabled={isStatusPending}
              tabIndex={isStatusPending ? -1 : 0}
              aria-label={labels.edit}
              title={labels.edit}
              className={`inline-flex items-center ${isStatusPending ? "pointer-events-none opacity-70" : ""}`}
            >
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={isStatusPending}
                tabIndex={-1}
              >
                <span>
                  <Pencil className="size-4" aria-hidden />
                </span>
              </Button>
            </Link>
          ) : null}
          {canMove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={tDetailActions("moveToWorkspace")}
              title={tDetailActions("moveToWorkspace")}
              disabled={actionsDisabled}
              onClick={() => setIsMoveOpen(true)}
            >
              <ArrowLeftRight className="size-4" aria-hidden />
            </Button>
          ) : null}
          {canEditOrDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={labels.delete}
              title={labels.delete}
              disabled={isDeletePending || isStatusPending}
              onClick={() => setIsOpen(true)}
            >
              <Trash className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
        {statusActions.length > 0 ? (
          <div
            className="flex items-center gap-1.5 border-l pl-3"
            data-testid="task-status-actions"
          >
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
          </div>
        ) : null}
      </div>

      <div
        className="flex items-center gap-1 md:hidden"
        data-testid="task-mobile-actions"
      >
        {mobilePrimaryStatusAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleStatusToggle(mobilePrimaryStatusAction.target)}
            disabled={isStatusPending}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {isStatusPending &&
            pendingStatusTarget === mobilePrimaryStatusAction.target ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <MobilePrimaryStatusIcon className="size-3" aria-hidden />
            )}
            <span>{mobilePrimaryStatusAction.label}</span>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              aria-label={actionsMenuLabel}
              disabled={isMobileActionsMenuDisabled}
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {mobileOverflowStatusActions.map((action) => {
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
            {mobileOverflowStatusActions.length > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem onSelect={() => setIsShareOpen(true)}>
              <Share className="size-4" aria-hidden />
              {labels.share}
            </DropdownMenuItem>
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

      <TaskShareModal
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        taskId={taskId}
        share={share}
      />

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
