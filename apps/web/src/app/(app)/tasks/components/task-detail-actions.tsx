"use client";

import {
  isTaskArchivableStatus,
  isTaskEditableStatus,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  Ellipsis,
  FlagTriangleRight,
  ListX,
  Loader2,
  LucideSquareMousePointer,
  OctagonMinus,
  Pencil,
  RotateCcw,
  SquareArrowRightExit,
  SquareMinus,
  SquareMousePointer,
  SquarePlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { canArchiveParkedTaskForViewer } from "@/app/tasks/utils/task-read-only";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  createTaskAndLink,
  createTaskLink,
  deleteTask,
  deleteTaskLink,
  setTaskStatusFromDrag,
} from "@/lib/actions/task/action";
import type {
  MemberWithOrganization,
  TaskShare,
} from "@/lib/clients/generated/core";
import {
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
} from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import { TaskForm, type TaskFormLabels } from "./task-form";
import { TaskFormModal } from "./task-form-modal";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";
import {
  type TaskLinkActionOption,
  TaskLinkTaskPickerDialog,
} from "./task-link-task-picker-dialog";
import { TaskShareButton } from "./task-share-button";
import { getWorkspaceMoveTargetCount } from "./workspace-move-targets";

interface TaskDetailActionsLabels {
  edit: string;
  archive: string;
  confirmArchive: string;
  confirmArchiveDescription: string;
  archiveError: string;
  markAsReady: string;
  reopenToReady: string;
  reopenToReadyTitle: string;
  reopenToReadyDescription: string;
  reopenToReadyCommentLabel: string;
  reopenToReadyCommentPlaceholder: string;
  reopenToReadyCommentRequired: string;
  reopenToReadyConfirm: string;
  revertToDraft: string;
  cancelRequest: string;
  share: string;
}

interface TaskStatusAction {
  label: string;
  target: TaskStatus;
  requiresComment?: boolean;
}

interface TaskDetailActionsProps {
  taskId: string;
  share: TaskShare | null;
  status: TaskStatus;
  jobsCount: number;
  taskLinks: TaskLink[];
  coworkerOptions: CoworkerOption[];
  agentNameById: Map<string, string>;
  defaultCoworkerId?: string | null;
  actionsMenuLabel: string;
  labels: TaskDetailActionsLabels;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel: string;
  isReadOnly?: boolean;
  forceReadOnly?: boolean;
  isTaskOwner?: boolean;
  isOrgOwnerOrAdmin?: boolean;
}

export function TaskDetailActions({
  taskId,
  share,
  status,
  jobsCount,
  taskLinks,
  coworkerOptions,
  agentNameById,
  defaultCoworkerId,
  actionsMenuLabel,
  labels,
  currentOrganizationId,
  organizations,
  personalWorkspaceLabel,
  isReadOnly = false,
  forceReadOnly = false,
  isTaskOwner = false,
  isOrgOwnerOrAdmin = false,
}: TaskDetailActionsProps) {
  const tApp = useTranslations("App");
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const tTasks = useTranslations("App.Tasks");
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isArchivePending, startArchiveTransition] = useTransition();
  const [isLinkPending, startLinkTransition] = useTransition();
  const [isParentRemovalPending, startParentRemovalTransition] =
    useTransition();
  const [isRemoveRelatedPending, startRemoveRelatedTransition] =
    useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [isMarkAsSectionOpen, setIsMarkAsSectionOpen] = useState(false);
  const [isCreateRelatedSectionOpen, setIsCreateRelatedSectionOpen] =
    useState(false);
  const [isRemoveRelatedSectionOpen, setIsRemoveRelatedSectionOpen] =
    useState(false);
  const [selectedTaskPickerOption, setSelectedTaskPickerOption] =
    useState<TaskLinkActionOption | null>(null);
  const [selectedCreateRelatedOption, setSelectedCreateRelatedOption] =
    useState<TaskLinkActionOption | null>(null);
  const [isCreateRelatedOpen, setIsCreateRelatedOpen] = useState(false);
  const [isCreateRelatedDismissDisabled, setIsCreateRelatedDismissDisabled] =
    useState(false);
  const [pendingStatusTarget, setPendingStatusTarget] =
    useState<TaskStatus | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenComment, setReopenComment] = useState("");
  const [pendingLinkTaskId, setPendingLinkTaskId] = useState<string | null>(
    null,
  );
  const [pendingRemoveLinkId, setPendingRemoveLinkId] = useState<string | null>(
    null,
  );

  const canMutateTask = !isReadOnly;
  const statusActions = canMutateTask
    ? getTaskStatusActions(status, labels, {
        hasCoworker: Boolean(defaultCoworkerId),
      })
    : [];

  const canEdit = canMutateTask && isTaskEditableStatus(status);
  const canArchiveParked = canArchiveParkedTaskForViewer({
    forceReadOnly,
    taskStatus: status,
    isTaskOwner,
    isOrgOwnerOrAdmin,
  });
  const canArchiveTask =
    canArchiveParked ||
    (isTaskArchivableStatus(status) && !isReadOnly && !forceReadOnly);
  const isFinalized =
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELED ||
    status === TaskStatus.CANCEL_REQUESTED;
  const canManageRelations = canMutateTask && !isFinalized;
  const canMove =
    canMutateTask &&
    !isFinalized &&
    getWorkspaceMoveTargetCount(currentOrganizationId, organizations) > 0;
  const parentLinks = useMemo(
    () => taskLinks.filter((link) => link.relation === TaskLinkRelation.CHILD),
    [taskLinks],
  );
  const removableTaskLinks = useMemo(
    () =>
      taskLinks.filter(
        (link) =>
          link.peerTask.archivedAt === null &&
          link.relation !== TaskLinkRelation.CHILD,
      ),
    [taskLinks],
  );
  const canRemoveRelated = canManageRelations && removableTaskLinks.length > 0;
  const canRemoveParent = canManageRelations && parentLinks.length > 0;
  const hasOverflowMenuActions =
    statusActions.length > 0 ||
    canEdit ||
    canManageRelations ||
    canMove ||
    canArchiveTask;
  const taskPickerOptions = useMemo(
    () => buildTaskPickerOptions(tDetailActions),
    [tDetailActions],
  );
  const createRelatedOptions = useMemo(
    () => buildCreateRelatedOptions(tDetailActions),
    [tDetailActions],
  );
  const createTaskLabels: TaskFormLabels = {
    details: tNewTask("details"),
    detailsDescription: tNewTask("detailsDescription"),
    name: tNewTask("name"),
    namePlaceholder: tNewTask("namePlaceholder"),
    descriptionPlaceholder: tNewTask("descriptionPlaceholder"),
    projectLabel: tNewTask("projectLabel"),
    projectNone: tNewTask("projectNone"),
    projectSearchPlaceholder: tNewTask("projectSearchPlaceholder"),
    projectEmptyResults: tNewTask("projectEmptyResults"),
    coworker: tNewTask("coworker"),
    coworkerDescription: tNewTask("coworkerDescription"),
    status: tNewTask("status"),
    statusDescription: tNewTask("statusDescription"),
    statusDraft: tNewTask("statusDraft"),
    statusQueued: tNewTask("statusQueued"),
    statusReady: tNewTask("statusReady"),
    back: tNewTask("back"),
    uploadFile: tNewTask("uploadFile"),
    uploadFileError: tNewTask("uploadFileError"),
    uploadingFile: getTaskAttachmentUploadLabelTemplate(
      tNewTask,
      "uploadingFile",
    ),
    uploadingFiles: getTaskAttachmentUploadLabelTemplate(
      tNewTask,
      "uploadingFiles",
    ),
    removeAttachment: tNewTask("removeAttachment"),
    submit: tNewTask("saveDraft"),
    saveAsDraft: tNewTask("saveAsDraft"),
    createTask: tNewTask("createTask"),
    scheduleTask: tNewTask("scheduleTask"),
    openSchedule: tNewTask("openSchedule"),
    cancel: tNewTask("cancel"),
    ctrl: tNewTask("ctrl"),
  };

  const handleStatusToggle = (action: TaskStatusAction) => {
    if (
      action.requiresComment ||
      userTaskStatusTransitionRequiresComment(status, action.target)
    ) {
      setReopenComment("");
      setIsReopenDialogOpen(true);
      return;
    }

    setPendingStatusTarget(action.target);

    startStatusTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId,
          desiredStatus: action.target,
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

  const handleReopenConfirm = () => {
    const trimmedComment = reopenComment.trim();
    if (!trimmedComment) {
      toast.error(labels.reopenToReadyCommentRequired);
      return;
    }

    setPendingStatusTarget(TaskStatus.READY);

    startStatusTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId,
          desiredStatus: TaskStatus.READY,
          comment: trimmedComment,
        });
        setIsReopenDialogOpen(false);
        setReopenComment("");
        router.refresh();
        toast.success(tDetailActions("updateStatusSuccess"));
      } catch (error) {
        console.error("Failed to reopen task", error);
        toast.error(tTasks("Errors.updateStatus"));
      } finally {
        setPendingStatusTarget(null);
      }
    });
  };

  const handleArchive = () => {
    startArchiveTransition(async () => {
      try {
        await deleteTask({ taskId });
        setIsOpen(false);
        router.push("/tasks");
      } catch (error) {
        console.error("Failed to archive task", error);
        toast.error(labels.archiveError);
      }
    });
  };

  const resetMobileSections = () => {
    setIsMarkAsSectionOpen(false);
    setIsCreateRelatedSectionOpen(false);
    setIsRemoveRelatedSectionOpen(false);
  };

  const handleDropdownOpenChange = (open: boolean) => {
    setIsDropdownOpen(open);

    if (!open) {
      resetMobileSections();
    }
  };

  const handleOpenTaskPicker = (option: TaskLinkActionOption) => {
    setSelectedTaskPickerOption(option);
    setIsTaskPickerOpen(true);
  };

  const handleOpenCreateRelated = (option: TaskLinkActionOption) => {
    setSelectedCreateRelatedOption(option);
    setIsCreateRelatedOpen(true);
  };

  const handleSelectLinkableTask = (
    option: TaskLinkActionOption,
    relatedTaskId: string,
  ) => {
    setPendingLinkTaskId(relatedTaskId);

    startLinkTransition(async () => {
      try {
        await createTaskLink({
          taskId,
          relatedTaskId,
          relation: option.relation,
        });
        setIsTaskPickerOpen(false);
        setSelectedTaskPickerOption(null);
        router.refresh();
        toast.success(tDetailActions("linkTaskSuccess"));
      } catch (error) {
        console.error("Failed to create task link", error);
        toast.error(tDetailActions("linkTaskError"));
      } finally {
        setPendingLinkTaskId(null);
      }
    });
  };

  const handleRemoveParent = () => {
    if (parentLinks.length === 0) return;

    startParentRemovalTransition(async () => {
      try {
        for (const link of parentLinks) {
          await deleteTaskLink({
            taskId,
            linkId: link.id,
          });
        }
        router.refresh();
        toast.success(tDetailActions("removeParentSuccess"));
      } catch (error) {
        console.error("Failed to remove parent task link", error);
        toast.error(tDetailActions("removeParentError"));
      }
    });
  };

  const handleRemoveRelated = (link: TaskLink) => {
    setPendingRemoveLinkId(link.id);

    startRemoveRelatedTransition(async () => {
      try {
        await deleteTaskLink({
          taskId,
          linkId: link.id,
        });
        router.refresh();
        toast.success(tDetailActions("removeRelatedSuccess"));
      } catch (error) {
        console.error("Failed to remove related task link", error);
        toast.error(tDetailActions("removeRelatedError"));
      } finally {
        setPendingRemoveLinkId(null);
      }
    });
  };

  const actionsDisabled =
    isStatusPending ||
    isArchivePending ||
    isLinkPending ||
    isParentRemovalPending ||
    isRemoveRelatedPending;

  return (
    <div className="flex items-center gap-2">
      {canMutateTask ? (
        <TaskShareButton
          task={{ id: taskId, share }}
          label={labels.share}
          variant="ghost"
          size="icon"
          className="size-7"
        />
      ) : null}
      {hasOverflowMenuActions ? (
        <DropdownMenu
          open={isDropdownOpen}
          onOpenChange={handleDropdownOpenChange}
        >
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
              const StatusIcon = action.requiresComment
                ? RotateCcw
                : getStatusActionMenuIcon(action.target);

              return (
                <DropdownMenuItem
                  className="cursor-pointer"
                  key={action.target}
                  disabled={actionsDisabled}
                  onSelect={() => handleStatusToggle(action)}
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

            {statusActions.length > 0 &&
            (canEdit || canManageRelations || canMove) ? (
              <DropdownMenuSeparator />
            ) : null}

            {canEdit ? (
              <DropdownMenuItem asChild disabled={actionsDisabled}>
                <Link
                  href={`/tasks/${taskId}/edit`}
                  className={
                    actionsDisabled ? "pointer-events-none opacity-70" : ""
                  }
                >
                  <Pencil className="size-4" aria-hidden />
                  {labels.edit}
                </Link>
              </DropdownMenuItem>
            ) : null}

            {canManageRelations ? (
              <>
                {isMobile ? (
                  <>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={actionsDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        setIsMarkAsSectionOpen((previous) => !previous);
                      }}
                    >
                      <FlagTriangleRight
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span>{tDetailActions("markAs")}</span>
                      <ChevronDown
                        className={cn(
                          "ml-auto size-4 text-muted-foreground transition-transform",
                          isMarkAsSectionOpen ? "rotate-180" : "",
                        )}
                        aria-hidden
                      />
                    </DropdownMenuItem>
                    {isMarkAsSectionOpen
                      ? taskPickerOptions.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            className="cursor-pointer pl-8"
                            disabled={actionsDisabled}
                            onSelect={() => handleOpenTaskPicker(option)}
                          >
                            <option.icon className="size-4" aria-hidden />
                            <span>{option.label}</span>
                          </DropdownMenuItem>
                        ))
                      : null}
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={actionsDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        setIsCreateRelatedSectionOpen((previous) => !previous);
                      }}
                    >
                      <LucideSquareMousePointer
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span>{tDetailActions("createRelated")}</span>
                      <ChevronDown
                        className={cn(
                          "ml-auto size-4 text-muted-foreground transition-transform",
                          isCreateRelatedSectionOpen ? "rotate-180" : "",
                        )}
                        aria-hidden
                      />
                    </DropdownMenuItem>
                    {isCreateRelatedSectionOpen
                      ? createRelatedOptions.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            className="cursor-pointer pl-8"
                            disabled={actionsDisabled}
                            onSelect={() => handleOpenCreateRelated(option)}
                          >
                            <option.icon className="size-4" aria-hidden />
                            <span>{option.label}</span>
                          </DropdownMenuItem>
                        ))
                      : null}
                  </>
                ) : (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="gap-2"
                        disabled={actionsDisabled}
                      >
                        <FlagTriangleRight
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                        {tDetailActions("markAs")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        {taskPickerOptions.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            disabled={actionsDisabled}
                            onSelect={() => handleOpenTaskPicker(option)}
                          >
                            <option.icon className="size-4" aria-hidden />
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="gap-2"
                        disabled={actionsDisabled}
                      >
                        <LucideSquareMousePointer
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                        {tDetailActions("createRelated")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        {createRelatedOptions.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            disabled={actionsDisabled}
                            onSelect={() => handleOpenCreateRelated(option)}
                          >
                            <option.icon className="size-4" aria-hidden />
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
                {canRemoveRelated ? (
                  isMobile ? (
                    <>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        disabled={actionsDisabled}
                        onSelect={(event) => {
                          event.preventDefault();
                          setIsRemoveRelatedSectionOpen(
                            (previous) => !previous,
                          );
                        }}
                      >
                        <ListX
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                        <span>{tDetailActions("removeRelated")}</span>
                        <ChevronDown
                          className={cn(
                            "ml-auto size-4 text-muted-foreground transition-transform",
                            isRemoveRelatedSectionOpen ? "rotate-180" : "",
                          )}
                          aria-hidden
                        />
                      </DropdownMenuItem>
                      {isRemoveRelatedSectionOpen
                        ? removableTaskLinks.map((link) => {
                            const RelationIcon = getTaskLinkRelationIcon(
                              link.relation,
                            );

                            return (
                              <DropdownMenuItem
                                key={link.id}
                                disabled={actionsDisabled}
                                onSelect={() => handleRemoveRelated(link)}
                                className="cursor-pointer pl-8"
                              >
                                {isRemoveRelatedPending &&
                                pendingRemoveLinkId === link.id ? (
                                  <Loader2
                                    className="size-4 animate-spin"
                                    aria-hidden
                                  />
                                ) : (
                                  <RelationIcon
                                    className={
                                      link.relation ===
                                        TaskLinkRelation.BLOCKS ||
                                      link.relation ===
                                        TaskLinkRelation.BLOCKED_BY
                                        ? "text-destructive size-4"
                                        : "size-4"
                                    }
                                    aria-hidden
                                  />
                                )}
                                <span className="truncate">
                                  {link.peerTask.name}
                                </span>
                              </DropdownMenuItem>
                            );
                          })
                        : null}
                    </>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="gap-2"
                        disabled={actionsDisabled}
                      >
                        <ListX
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                        {tDetailActions("removeRelated")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        {removableTaskLinks.map((link) => {
                          const RelationIcon = getTaskLinkRelationIcon(
                            link.relation,
                          );

                          return (
                            <DropdownMenuItem
                              key={link.id}
                              disabled={actionsDisabled}
                              onSelect={() => handleRemoveRelated(link)}
                              className="cursor-pointer"
                            >
                              {isRemoveRelatedPending &&
                              pendingRemoveLinkId === link.id ? (
                                <Loader2
                                  className="size-4 animate-spin"
                                  aria-hidden
                                />
                              ) : (
                                <RelationIcon
                                  className={
                                    link.relation === TaskLinkRelation.BLOCKS ||
                                    link.relation ===
                                      TaskLinkRelation.BLOCKED_BY
                                      ? "text-destructive size-4"
                                      : "size-4"
                                  }
                                  aria-hidden
                                />
                              )}
                              <span className="truncate">
                                {link.peerTask.name}
                              </span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                ) : null}
                {canRemoveParent ? (
                  <DropdownMenuItem
                    disabled={actionsDisabled}
                    onSelect={handleRemoveParent}
                  >
                    {isParentRemovalPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <SquareArrowRightExit className="size-4" aria-hidden />
                    )}
                    {tDetailActions("removeParent")}
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}

            {(canEdit || canManageRelations) && canMove ? (
              <DropdownMenuSeparator />
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

            {canArchiveTask &&
            (statusActions.length > 0 ||
              canEdit ||
              canManageRelations ||
              canMove) ? (
              <DropdownMenuSeparator />
            ) : null}

            {canArchiveTask ? (
              <DropdownMenuItem
                disabled={actionsDisabled}
                onSelect={() => setIsOpen(true)}
              >
                <Archive className="size-4" aria-hidden />
                {labels.archive}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canArchiveTask ? (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.confirmArchive}</AlertDialogTitle>
              <AlertDialogDescription>
                {labels.confirmArchiveDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isArchivePending}>
                {tApp("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleArchive}
                disabled={isArchivePending}
              >
                {labels.archive}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <Dialog
        open={isReopenDialogOpen}
        onOpenChange={(open) => {
          setIsReopenDialogOpen(open);
          if (!open) {
            setReopenComment("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.reopenToReadyTitle}</DialogTitle>
            <DialogDescription>
              {labels.reopenToReadyDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label
              htmlFor="task-reopen-comment"
              className="text-sm font-medium"
            >
              {labels.reopenToReadyCommentLabel}
            </label>
            <Textarea
              id="task-reopen-comment"
              value={reopenComment}
              onChange={(event) => setReopenComment(event.target.value)}
              placeholder={labels.reopenToReadyCommentPlaceholder}
              rows={4}
              disabled={isStatusPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isStatusPending}
              onClick={() => {
                setIsReopenDialogOpen(false);
                setReopenComment("");
              }}
            >
              {tApp("cancel")}
            </Button>
            <Button
              type="button"
              disabled={isStatusPending || !reopenComment.trim()}
              onClick={handleReopenConfirm}
            >
              {isStatusPending && pendingStatusTarget === TaskStatus.READY ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {labels.reopenToReadyConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <TaskLinkTaskPickerDialog
        taskId={taskId}
        open={isTaskPickerOpen}
        onOpenChange={(open) => {
          setIsTaskPickerOpen(open);
          if (!open) {
            setPendingLinkTaskId(null);
            setSelectedTaskPickerOption(null);
          }
        }}
        selectedOption={selectedTaskPickerOption}
        isLinkPending={isLinkPending}
        pendingLinkTaskId={pendingLinkTaskId}
        onSelectTask={handleSelectLinkableTask}
      />

      {selectedCreateRelatedOption ? (
        <TaskFormModal
          open={isCreateRelatedOpen}
          onOpenChange={(open) => {
            setIsCreateRelatedOpen(open);
            if (!open) {
              setSelectedCreateRelatedOption(null);
            }
          }}
          title={tDetailActions("createRelatedDialogTitle", {
            relation: selectedCreateRelatedOption.label,
          })}
          cancelLabel={createTaskLabels.cancel}
          isDismissDisabled={isCreateRelatedDismissDisabled}
        >
          <TaskForm
            variant="modal"
            mode="create"
            showCancel={false}
            labels={createTaskLabels}
            coworkerOptions={coworkerOptions}
            agentNameById={agentNameById}
            initialValues={
              defaultCoworkerId ? { coworkerId: defaultCoworkerId } : undefined
            }
            onCreateTask={async ({
              description,
              coworkerId,
              projectId,
              status,
              schedule,
            }) => {
              const result = await createTaskAndLink({
                taskId,
                description,
                coworkerId,
                projectId,
                status,
                schedule,
                relation: selectedCreateRelatedOption.relation,
              });

              return {
                taskId: result.createdTaskId,
                name: result.name,
              };
            }}
            onSubmittingChange={setIsCreateRelatedDismissDisabled}
            onCancel={() => {
              setIsCreateRelatedOpen(false);
              setSelectedCreateRelatedOption(null);
            }}
            onCreated={() => {
              router.refresh();
              toast.success(tDetailActions("createRelatedSuccess"));
            }}
            onSuccess={(createdTaskId) => {
              setIsCreateRelatedOpen(false);
              setSelectedCreateRelatedOption(null);
              router.push(`/tasks/${createdTaskId}`);
            }}
          />
        </TaskFormModal>
      ) : null}
    </div>
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
  options: { hasCoworker: boolean },
): TaskStatusAction[] {
  if (status === TaskStatus.DRAFT) {
    return [{ label: labels.markAsReady, target: TaskStatus.READY }];
  }

  if (status === TaskStatus.READY) {
    return [{ label: labels.revertToDraft, target: TaskStatus.DRAFT }];
  }

  if (
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
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

  // READY still requires a coworker assignment in Core; canceled drafts without
  // a coworker cannot be patched while terminal, so hide reopen in that case.
  if (
    (status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED) &&
    options.hasCoworker
  ) {
    return [
      {
        label: labels.reopenToReady,
        target: TaskStatus.READY,
        requiresComment: true,
      },
    ];
  }

  return [];
}

function buildTaskPickerOptions(
  tDetailActions: ReturnType<typeof useTranslations>,
): TaskLinkActionOption[] {
  return [
    {
      id: "related",
      label: tDetailActions("relations.related"),
      relation: TaskLinkRelation.RELATED,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.RELATED),
    },
    {
      id: "subtask",
      label: tDetailActions("relations.subtask"),
      relation: TaskLinkRelation.CHILD,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.PARENT),
    },
    {
      id: "blocks",
      label: tDetailActions("relations.blocks"),
      relation: TaskLinkRelation.BLOCKS,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.BLOCKS),
    },
    {
      id: "blocked-by",
      label: tDetailActions("relations.blockedBy"),
      relation: TaskLinkRelation.BLOCKED_BY,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.BLOCKED_BY),
    },
    {
      id: "duplicate",
      label: tDetailActions("relations.duplicate"),
      relation: TaskLinkRelation.DUPLICATE,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.DUPLICATE),
    },
  ];
}

function buildCreateRelatedOptions(
  tDetailActions: ReturnType<typeof useTranslations>,
): TaskLinkActionOption[] {
  return [
    {
      id: "related",
      label: tDetailActions("relations.related"),
      relation: TaskLinkRelation.RELATED,
      icon: SquareMousePointer,
    },
    {
      id: "add-subtask",
      label: tDetailActions("relations.addSubtask"),
      relation: TaskLinkRelation.PARENT,
      icon: SquarePlus,
    },
    {
      id: "blocks",
      label: tDetailActions("relations.blocks"),
      relation: TaskLinkRelation.BLOCKS,
      icon: OctagonMinus,
    },
    {
      id: "blocked-by",
      label: tDetailActions("relations.blockedBy"),
      relation: TaskLinkRelation.BLOCKED_BY,
      icon: SquareMinus,
    },
  ];
}
