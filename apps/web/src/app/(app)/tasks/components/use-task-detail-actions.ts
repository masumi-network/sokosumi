"use client";

import type {
  ChatRoom,
  MemberWithOrganization,
  TaskShare,
} from "@sokosumi/core-client";
import {
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  isTaskArchivableStatus,
  isTaskEditableStatus,
  type TaskAssigneeKind,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { loadTaskScheduleDialogOptions } from "@/app/tasks/actions";
import type { TaskWorkspaceTag } from "@/app/tasks/types/task-board";
import {
  markTaskArchived,
  unmarkTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";
import { chatRoomsForTask } from "@/app/tasks/utils/task-chat-share";
import { canArchiveParkedTaskForViewer } from "@/app/tasks/utils/task-read-only";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { listOrganizationChatRoomsAction } from "@/components/chat/organization-chat-list.actions";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  createTaskLink,
  deleteTaskLink,
  setTaskStatusFromDrag,
} from "@/lib/actions/task/action";
import { viewerIsOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { taskClientService } from "@/lib/services/task.client";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskMutationErrorKind } from "@/lib/utils/task-mutation-error-kinds";
import type { TaskPickerTask } from "./task-detail-api-types";
import { buildNewTaskFormLabels } from "./task-detail-new-task-labels";
import { useOptimisticTaskStatus } from "./task-detail-optimistic";
import { useOptimisticTaskLinks } from "./task-detail-optimistic-links";
import { type TaskFormInitialDesignMdAttachment } from "./task-form";
import {
  buildCreateRelatedOptions,
  buildTaskPickerOptions,
} from "./task-link-action-options";
import { type TaskLinkActionOption } from "./task-link-task-picker-dialog";
import { type TaskScheduleBlueprintPrefill } from "./task-schedule-dialog";
import { getWorkspaceMoveTargetCount } from "./workspace-move-targets";

interface TaskDetailActionsLabels {
  edit: string;
  archive: string;
  archiveError: string;
  reopenToReady: string;
  reopenToReadyTitle: string;
  reopenToReadyDescription: string;
  reopenToReadyCommentLabel: string;
  reopenToReadyCommentPlaceholder: string;
  reopenToReadyCommentRequired: string;
  reopenToReadyConfirm: string;
  cancel: string;
  share: string;
  startWorking: string;
  pauseToReady: string;
  waitExternal: string;
  resumeRunning: string;
  resumeReady: string;
  markComplete: string;
}

interface TaskStatusAction {
  label: string;
  target: TaskStatus;
  requiresComment?: boolean;
}

export interface TaskDetailActionsProps {
  taskId: string;
  share: TaskShare | null;
  status: TaskStatus;
  /** When PRIVATE, public share controls are hidden. */
  taskVisibility?: "PUBLIC" | "PRIVATE";
  jobsCount: number;
  taskLinks: TaskLink[];
  coworkerOptions: CoworkerOption[];
  agentNameById: Map<string, string>;
  defaultAssigneeId?: string | null;
  assigneeKind?: TaskAssigneeKind;
  /** Resolved DESIGN.md for create-related flow (same picker as new task). */
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  actionsMenuLabel: string;
  labels: TaskDetailActionsLabels;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
  hasPersonalWorkspace?: boolean;
  personalWorkspaceLabel: string;
  isReadOnly?: boolean;
  canCancel?: boolean;
  forceReadOnly?: boolean;
  isTaskOwner?: boolean;
  /** Null when the Task has no Owner. Archive and move then need an org owner or admin. */
  taskOwnerId: string | null;
  hasAssignedSeat?: boolean;
  /**
   * The Task as a reusable brief, for "Repeat" (a Task Schedule) and
   * "Duplicate" (a new Draft). Omitted where the viewer cannot create either;
   * the Task itself is never changed.
   */
  taskBlueprint?: TaskScheduleBlueprintPrefill & {
    workspaceTags?: TaskWorkspaceTag[];
  };
  /**
   * "Send to chat": post the Task's link into a chat room. Omitted for
   * private Tasks and read-only views; Core re-checks both at send time and
   * the link never grants access.
   */
  sendToChat?: { currentUserId: string };
}

export function useTaskDetailActions({
  taskId,
  share,
  status: savedStatus,
  taskVisibility = "PUBLIC",
  jobsCount,
  taskLinks,
  coworkerOptions,
  agentNameById,
  defaultAssigneeId,
  assigneeKind,
  initialDesignMdAttachment = null,
  actionsMenuLabel,
  labels,
  currentOrganizationId,
  organizations,
  hasPersonalWorkspace = false,
  personalWorkspaceLabel,
  isReadOnly = false,
  canCancel = false,
  forceReadOnly = false,
  isTaskOwner = false,
  taskOwnerId,
  hasAssignedSeat = false,
  taskBlueprint,
  sendToChat,
}: TaskDetailActionsProps) {
  const tApp = useTranslations("App");
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const tTasks = useTranslations("App.Tasks");
  const router = useRouter();
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const isMobile = useIsMobile();
  const [status, showStatus, isStatusChanging] =
    useOptimisticTaskStatus(savedStatus);
  const [, showLinkChange] = useOptimisticTaskLinks();
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isLinkPending, startLinkTransition] = useTransition();
  const [isParentRemovalPending, startParentRemovalTransition] =
    useTransition();
  const [isRemoveRelatedPending, startRemoveRelatedTransition] =
    useTransition();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
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
  const [pendingRemoveLinkId, setPendingRemoveLinkId] = useState<string | null>(
    null,
  );
  const [repeatOptions, setRepeatOptions] = useState<{
    coworkerOptions: CoworkerOption[];
    projectOptions: ProjectFilterOption[];
  } | null>(null);
  const [isRepeatLoading, startRepeatTransition] = useTransition();
  const [chatRooms, setChatRooms] = useState<ChatRoom[] | null>(null);
  const [isChatRoomsLoading, startChatRoomsTransition] = useTransition();

  const newTaskWizard = useOptionalNewTaskWizard();
  // A copy carries the brief, assignee and tags only: no Run at, due date,
  // jobs, payments, schedule, relations or priority. It opens in the New Task form
  // as a Draft, so nothing runs until the viewer reviews and saves it.
  const handleDuplicate = () => {
    if (!taskBlueprint || !newTaskWizard) return;
    newTaskWizard.openNewTaskWizard({
      prompt: taskBlueprint.description ?? null,
      projectId: taskBlueprint.projectId ?? null,
      copy: {
        workspaceTags: taskBlueprint.workspaceTags,
        taskId,
        name: taskBlueprint.name ?? "",
        visibility: taskBlueprint.visibility ?? "PUBLIC",
        assigneeId: taskBlueprint.assigneeId ?? null,
        assigneeSokoBotId: taskBlueprint.assigneeSokoBotId ?? null,
        assigneeUserId: taskBlueprint.assigneeUserId ?? null,
      },
    });
  };

  const handleRepeat = () => {
    startRepeatTransition(async () => {
      try {
        setRepeatOptions(await loadTaskScheduleDialogOptions());
      } catch (error) {
        console.error("Failed to load Task Schedule options", error);
        toast.error(tDetailActions("repeatError"));
      }
    });
  };

  const handleSendToChat = () => {
    if (!sendToChat) return;
    startChatRoomsTransition(async () => {
      const result = await listOrganizationChatRoomsAction();
      if (!result.ok) {
        toast.error(tDetailActions("sendToChat.loadError"));
        return;
      }
      setChatRooms(
        chatRoomsForTask(result.value.rooms, currentOrganizationId ?? null),
      );
    });
  };

  const canMutateTask = !isReadOnly;
  const availableStatusActions = getTaskStatusActions(status, labels, {
    assigneeKind: assigneeKind ?? (defaultAssigneeId ? "coworker" : "unset"),
  });
  const statusActions = canMutateTask
    ? availableStatusActions
    : canCancel
      ? availableStatusActions.filter(
          (action) => action.target === TaskStatus.CANCELED,
        )
      : [];

  const canEdit = canMutateTask && isTaskEditableStatus(status);
  // A Task with an Owner keeps the old gates. One without an Owner can be
  // archived or moved only by an organization owner or admin, and never into
  // a personal workspace (ADR 0057).
  const canManageUnowned =
    taskOwnerId === null &&
    viewerIsOrganizationOwnerOrAdmin(currentOrganizationId, organizations);
  const canArchiveUnowned = taskOwnerId !== null || canManageUnowned;
  const canArchiveParked =
    canArchiveUnowned &&
    canArchiveParkedTaskForViewer({
      forceReadOnly,
      taskStatus: status,
      isTaskOwner,
      isOrganizationTask: currentOrganizationId != null,
      hasAssignedSeat,
    });
  const canArchiveTask =
    canArchiveParked ||
    (canArchiveUnowned &&
      isTaskArchivableStatus(status) &&
      !isReadOnly &&
      !forceReadOnly);
  const isFinalized =
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELED;
  const canManageRelations = canMutateTask && !isFinalized;
  const personalMoveAllowed = taskOwnerId !== null && hasPersonalWorkspace;
  const canMove =
    canMutateTask &&
    (isTaskOwner || canManageUnowned) &&
    !isFinalized &&
    getWorkspaceMoveTargetCount(
      currentOrganizationId,
      organizations,
      personalMoveAllowed,
    ) > 0;
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
    taskBlueprint !== undefined ||
    sendToChat !== undefined ||
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
  const createTaskLabels = buildNewTaskFormLabels(tNewTask);

  /**
   * A rejected status write is a state, not a crash: a stale status list gets
   * the status error, and only a stale client gets the reload modal.
   */
  const reportStatusRejection = (kind: TaskMutationErrorKind) => {
    if (kind === CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE) {
      toast.error(tTasks("Errors.updateStatus"));
      router.refresh();
      return;
    }
    showCalendarClientUpgradeModal();
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
      showStatus(action.target);
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus: action.target,
        });
        if (!result.ok) {
          reportStatusRejection(result.error.kind);
          return;
        }
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
      showStatus(TaskStatus.READY);
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus: TaskStatus.READY,
          comment: trimmedComment,
        });
        if (!result.ok) {
          reportStatusRejection(result.error.kind);
          return;
        }
        setIsReopenDialogOpen(false);
        setReopenComment("");
        toast.success(tDetailActions("updateStatusSuccess"));
      } catch (error) {
        console.error("Failed to reopen task", error);
        toast.error(tTasks("Errors.updateStatus"));
      } finally {
        setPendingStatusTarget(null);
      }
    });
  };

  // Leaves for the board at once and archives in the background: the board
  // already hides the task, and shows it again if the archive fails.
  const handleArchive = () => {
    markTaskArchived(taskId);
    router.push("/tasks");
    taskClientService.archive(taskId).catch((error: unknown) => {
      console.error("Failed to archive task", error);
      unmarkTaskArchived(taskId);
      toast.error(labels.archiveError);
      router.refresh();
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
    relatedTask: TaskPickerTask,
  ) => {
    // Closed outside the transition: a state change inside it would wait for
    // the answer.
    setIsTaskPickerOpen(false);
    setSelectedTaskPickerOption(null);

    // Core refuses a second link to the same task, so that pick shows nothing.
    const isNewPeer = taskLinks.every(
      (link) => link.peerTask.id !== relatedTask.id,
    );

    startLinkTransition(async () => {
      // A new parent takes the place of the one the task has.
      if (isNewPeer && option.relation === TaskLinkRelation.CHILD) {
        for (const link of parentLinks) {
          showLinkChange({ hidePeerTaskId: link.peerTask.id });
        }
      }
      if (isNewPeer) {
        showLinkChange({
          add: { ...relatedTask, identifier: null, relation: option.relation },
        });
      }
      try {
        await createTaskLink({
          taskId,
          relatedTaskId: relatedTask.id,
          relation: option.relation,
        });
        toast.success(tDetailActions("linkTaskSuccess"));
      } catch (error) {
        console.error("Failed to create task link", error);
        toast.error(tDetailActions("linkTaskError"));
      }
    });
  };

  const handleRemoveParent = () => {
    if (parentLinks.length === 0) return;

    startParentRemovalTransition(async () => {
      for (const link of parentLinks) {
        showLinkChange({ hidePeerTaskId: link.peerTask.id });
      }
      try {
        for (const link of parentLinks) {
          await deleteTaskLink({
            taskId,
            linkId: link.id,
          });
        }
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
      showLinkChange({ hidePeerTaskId: link.peerTask.id });
      try {
        await deleteTaskLink({
          taskId,
          linkId: link.id,
        });
        toast.success(tDetailActions("removeRelatedSuccess"));
      } catch (error) {
        console.error("Failed to remove related task link", error);
        toast.error(tDetailActions("removeRelatedError"));
      } finally {
        setPendingRemoveLinkId(null);
      }
    });
  };

  // The gates above follow a status that Core has not confirmed yet, so
  // nothing here acts on it while a status write is open, here or in the panel.
  const actionsDisabled =
    isStatusPending ||
    isStatusChanging ||
    isLinkPending ||
    isParentRemovalPending ||
    isRemoveRelatedPending;

  return {
    taskId,
    share,
    taskVisibility,
    coworkerOptions,
    actionsMenuLabel,
    labels,
    currentOrganizationId,
    organizations,
    hasPersonalWorkspace,
    personalWorkspaceLabel,
    taskBlueprint,
    sendToChat,
    tApp,
    tDetailActions,
    router,
    isMobile,
    isStatusPending,
    isLinkPending,
    isParentRemovalPending,
    isRemoveRelatedPending,
    isDropdownOpen,
    menuTriggerRef,
    isMoveOpen,
    setIsMoveOpen,
    isTaskPickerOpen,
    setIsTaskPickerOpen,
    isMarkAsSectionOpen,
    setIsMarkAsSectionOpen,
    isCreateRelatedSectionOpen,
    setIsCreateRelatedSectionOpen,
    isRemoveRelatedSectionOpen,
    setIsRemoveRelatedSectionOpen,
    selectedTaskPickerOption,
    setSelectedTaskPickerOption,
    pendingStatusTarget,
    isReopenDialogOpen,
    setIsReopenDialogOpen,
    reopenComment,
    setReopenComment,
    pendingRemoveLinkId,
    repeatOptions,
    setRepeatOptions,
    isRepeatLoading,
    chatRooms,
    setChatRooms,
    isChatRoomsLoading,
    newTaskWizard,
    handleDuplicate,
    handleRepeat,
    handleSendToChat,
    canMutateTask,
    statusActions,
    canEdit,
    canArchiveTask,
    canManageRelations,
    personalMoveAllowed,
    canMove,
    removableTaskLinks,
    canRemoveRelated,
    canRemoveParent,
    hasOverflowMenuActions,
    taskPickerOptions,
    createRelatedOptions,
    handleStatusToggle,
    handleReopenConfirm,
    handleArchive,
    handleDropdownOpenChange,
    handleOpenTaskPicker,
    handleOpenCreateRelated,
    handleSelectLinkableTask,
    handleRemoveParent,
    handleRemoveRelated,
    actionsDisabled,
    agentNameById,
    defaultAssigneeId,
    assigneeKind,
    initialDesignMdAttachment,
    status,
    selectedCreateRelatedOption,
    setSelectedCreateRelatedOption,
    isCreateRelatedOpen,
    setIsCreateRelatedOpen,
    isCreateRelatedDismissDisabled,
    setIsCreateRelatedDismissDisabled,
    createTaskLabels,
  };
}
function getTaskStatusActions(
  status: TaskStatus,
  labels: TaskDetailActionsLabels,
  options: {
    assigneeKind?: TaskAssigneeKind;
  },
): TaskStatusAction[] {
  const isHuman =
    options.assigneeKind === "human" || options.assigneeKind === "unset";

  if (status === TaskStatus.DRAFT) {
    return [];
  }

  if (status === TaskStatus.READY) {
    if (isHuman) {
      return [{ label: labels.startWorking, target: TaskStatus.RUNNING }];
    }
    return [];
  }

  if (status === TaskStatus.RUNNING && isHuman) {
    return [
      { label: labels.markComplete, target: TaskStatus.COMPLETED },
      { label: labels.waitExternal, target: TaskStatus.AWAITING_EXTERNAL },
      { label: labels.pauseToReady, target: TaskStatus.READY },
      { label: labels.cancel, target: TaskStatus.CANCELED },
    ];
  }

  if (status === TaskStatus.AWAITING_EXTERNAL && isHuman) {
    return [
      { label: labels.resumeRunning, target: TaskStatus.RUNNING },
      { label: labels.markComplete, target: TaskStatus.COMPLETED },
      { label: labels.resumeReady, target: TaskStatus.READY },
      { label: labels.cancel, target: TaskStatus.CANCELED },
    ];
  }

  if (
    status === TaskStatus.QUEUED ||
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
    status === TaskStatus.AUTHENTICATION_REQUIRED ||
    status === TaskStatus.OUT_OF_CREDITS ||
    status === TaskStatus.CREDITS_TOPPED_UP ||
    status === TaskStatus.RUNNING ||
    status === TaskStatus.AWAITING_EXTERNAL
  ) {
    return [
      {
        label: labels.cancel,
        target: TaskStatus.CANCELED,
      },
    ];
  }

  // Unset Ready is valid (SOK-868); terminal tasks reopen to Ready with a
  // comment whether an agent, a human, or nobody is assigned.
  if (status === TaskStatus.COMPLETED || status === TaskStatus.CANCELED) {
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
