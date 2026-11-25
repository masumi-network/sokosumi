"use client";

import type {
  ChatRoom,
  MemberWithOrganization,
  TaskShare,
} from "@sokosumi/core-client";
import { type TaskLink, TaskStatus } from "@sokosumi/core-client";
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
import {
  isTaskArchivePending,
  markTaskArchived,
  settleTaskArchive,
  unmarkTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";
import { chatRoomsForTask } from "@/app/tasks/utils/task-chat-share";
import {
  canArchiveParkedTaskForViewer,
  isFinalizedTaskStatus,
} from "@/app/tasks/utils/task-read-only";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { listOrganizationChatRoomsAction } from "@/components/chat/organization-chat-list.actions";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { useIsMobile } from "@/hooks/effects/use-mobile";
import {
  createTaskLink,
  deleteTaskLink,
  revalidateTasksAfterArchive,
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
import type { TaskFormTagPrefill } from "./task-form-types";
import {
  buildCreateRelatedOptions,
  buildTaskPickerOptions,
  type CreateRelatedOption,
} from "./task-link-action-options";
import { type TaskLinkActionOption } from "./task-link-task-picker-dialog";
import { type TaskScheduleBlueprintPrefill } from "./task-schedule-dialog";
import {
  getTaskStatusActions,
  type TaskDetailActionsLabels,
  type TaskStatusAction,
} from "./task-status-actions";
import { getWorkspaceMoveTargetCount } from "./workspace-move-targets";

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
  /** Named in the send-back dialog of a Coworker or Soko Bot Task. */
  assigneeName?: string | null;
  /** Resolved DESIGN.md for create-related flow (same picker as new task). */
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  actionsMenuLabel: string;
  labels: TaskDetailActionsLabels;
  workspaceId?: string;
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
  taskBlueprint?: TaskScheduleBlueprintPrefill & TaskFormTagPrefill;
  /**
   * "Send to chat": post the Task's link into a chat room. Omitted for
   * private Tasks and read-only views; Core re-checks both at send time and
   * the link never grants access.
   */
  sendToChat?: { currentUserId: string };
  /** The Task's parent, when it is a sub-task. */
  parentTaskId?: string | null;
  /** The Task's parent chain, root first. */
  ancestorIds?: readonly string[];
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
  assigneeName,
  initialDesignMdAttachment = null,
  actionsMenuLabel,
  labels,
  workspaceId,
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
  const [isRemoveRelatedPending, startRemoveRelatedTransition] =
    useTransition();
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [isLinkToTaskSectionOpen, setIsLinkToTaskSectionOpen] = useState(false);
  const [isCreateRelatedSectionOpen, setIsCreateRelatedSectionOpen] =
    useState(false);
  const [isRemoveRelatedSectionOpen, setIsRemoveRelatedSectionOpen] =
    useState(false);
  const [selectedTaskPickerOption, setSelectedTaskPickerOption] =
    useState<TaskLinkActionOption | null>(null);
  const [selectedCreateRelatedOption, setSelectedCreateRelatedOption] =
    useState<CreateRelatedOption | null>(null);
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
        tags: taskBlueprint.tags,
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
  const resolvedAssigneeKind =
    assigneeKind ?? (defaultAssigneeId ? "coworker" : "unset");
  const hasAgentAssignee =
    resolvedAssigneeKind === "coworker" || resolvedAssigneeKind === "sokoBot";
  const availableStatusActions = getTaskStatusActions(status, labels, {
    assigneeKind: resolvedAssigneeKind,
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
  const isFinalized = isFinalizedTaskStatus(status);
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
  const removableTaskLinks = useMemo(
    () => taskLinks.filter((link) => link.peerTask.archivedAt === null),
    [taskLinks],
  );
  const canRemoveRelated = canManageRelations && removableTaskLinks.length > 0;
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
      userTaskStatusTransitionRequiresComment(
        status,
        action.target,
        hasAgentAssignee,
      )
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

  // Draft starts no run, so it needs no instructions.
  const handleReopenConfirm = (
    target: typeof TaskStatus.READY | typeof TaskStatus.DRAFT,
  ) => {
    const trimmedComment = reopenComment.trim();
    if (target === TaskStatus.READY && !trimmedComment) {
      toast.error(labels.reopenToReadyCommentRequired);
      return;
    }

    setPendingStatusTarget(target);

    startStatusTransition(async () => {
      showStatus(target);
      try {
        const result = await setTaskStatusFromDrag({
          taskId,
          desiredStatus: target,
          ...(target === TaskStatus.READY ? { comment: trimmedComment } : {}),
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
    if (isTaskArchivePending(taskId)) return;
    setIsArchiving(true);
    markTaskArchived(taskId);
    router.push("/tasks");
    taskClientService
      .archive(taskId)
      .then(() =>
        // shortcut: holds an uncommitted navigation for one revalidation round trip (Next action queue); revisit if Next adds a client cache-invalidation API
        revalidateTasksAfterArchive()
          .then((revalidated) => {
            settleTaskArchive(taskId);
            setIsArchiving(false);
            if (!revalidated) {
              router.refresh();
            }
          })
          .catch((error: unknown) => {
            console.error("Failed to revalidate tasks after archive", error);
            settleTaskArchive(taskId);
            setIsArchiving(false);
            router.refresh();
          }),
      )
      .catch((error: unknown) => {
        console.error("Failed to archive task", error);
        unmarkTaskArchived(taskId);
        setIsArchiving(false);
        toast.error(labels.archiveError);
      });
  };

  const resetMobileSections = () => {
    setIsLinkToTaskSectionOpen(false);
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

  const handleOpenCreateRelated = (option: CreateRelatedOption) => {
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
    isArchiving ||
    isStatusPending ||
    isStatusChanging ||
    isLinkPending ||
    isRemoveRelatedPending;

  return {
    taskId,
    share,
    taskVisibility,
    coworkerOptions,
    actionsMenuLabel,
    labels,
    workspaceId,
    currentOrganizationId,
    organizations,
    hasPersonalWorkspace,
    personalWorkspaceLabel,
    taskBlueprint,
    sendToChat,
    assigneeName,
    tDetailActions,
    router,
    isMobile,
    isStatusPending,
    isLinkPending,
    isRemoveRelatedPending,
    isDropdownOpen,
    menuTriggerRef,
    isMoveOpen,
    setIsMoveOpen,
    isTaskPickerOpen,
    setIsTaskPickerOpen,
    isLinkToTaskSectionOpen,
    setIsLinkToTaskSectionOpen,
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
