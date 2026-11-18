"use client";

import { TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  CopyPlus,
  Ellipsis,
  FlagTriangleRight,
  ListX,
  Loader2,
  LucideSquareMousePointer,
  MessageSquareShare,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { taskSchedulePath } from "@/app/tasks/utils/task-schedule-view";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";
import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";
import { TaskCreateRelatedModal } from "./task-create-related-modal";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";
import { TaskLinkTaskPickerDialog } from "./task-link-task-picker-dialog";
import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskScheduleDialog } from "./task-schedule-dialog";
import { TaskSendToChatDialog } from "./task-send-to-chat-dialog";
import { TaskShareButton } from "./task-share-button";
import {
  TaskSubtaskMenuDialogs,
  TaskSubtaskMenuItems,
} from "./task-subtask-menu";
import {
  type TaskDetailActionsProps,
  useTaskDetailActions,
} from "./use-task-detail-actions";
import { useTaskSubtaskActions } from "./use-task-subtask-actions";

const NO_ANCESTORS: readonly string[] = [];

export function TaskDetailActions(props: TaskDetailActionsProps) {
  const model = useTaskDetailActions(props);
  const subtaskActions = useTaskSubtaskActions({
    taskId: props.taskId,
    parentTaskId: props.parentTaskId ?? null,
    ancestorIds: props.ancestorIds ?? NO_ANCESTORS,
    canManageRelations: model.canManageRelations,
  });
  const {
    taskId,
    share,
    taskVisibility,
    actionsMenuLabel,
    labels,
    currentOrganizationId,
    organizations,
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
  } = model;
  const actionsDisabled = model.actionsDisabled || subtaskActions.isPending;
  const returnFocusToMenu = (event: Event) => {
    event.preventDefault();
    menuTriggerRef.current?.focus();
  };
  return (
    <div className="flex items-center gap-2">
      {canArchiveTask ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 md:size-8"
          aria-label={labels.archive}
          title={labels.archive}
          disabled={actionsDisabled}
          onClick={handleArchive}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
      {canMutateTask && taskVisibility !== "PRIVATE" ? (
        <TaskShareButton
          task={{ id: taskId, share }}
          label={labels.share}
          variant="ghost"
          size="icon"
          className="size-10 md:size-8"
        />
      ) : null}
      {hasOverflowMenuActions ? (
        <DropdownMenu
          open={isDropdownOpen}
          onOpenChange={handleDropdownOpenChange}
        >
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTriggerRef}
              type="button"
              variant="outline"
              size="icon"
              className="size-10 md:size-8 shrink-0"
              aria-label={actionsMenuLabel}
              disabled={actionsDisabled}
            >
              <Ellipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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

            {taskBlueprint ? (
              <DropdownMenuItem
                disabled={actionsDisabled || isRepeatLoading}
                onSelect={handleRepeat}
              >
                {isRepeatLoading ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : (
                  <Repeat className="size-4" aria-hidden />
                )}
                {tDetailActions("repeat")}
              </DropdownMenuItem>
            ) : null}

            {taskBlueprint && newTaskWizard ? (
              <DropdownMenuItem
                disabled={actionsDisabled}
                onSelect={handleDuplicate}
              >
                <CopyPlus className="size-4" aria-hidden />
                {tDetailActions("duplicate")}
              </DropdownMenuItem>
            ) : null}

            {sendToChat ? (
              <DropdownMenuItem
                disabled={actionsDisabled || isChatRoomsLoading}
                onSelect={handleSendToChat}
              >
                {isChatRoomsLoading ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : (
                  <MessageSquareShare className="size-4" aria-hidden />
                )}
                {tDetailActions("sendToChat.menuItem")}
              </DropdownMenuItem>
            ) : null}

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
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-pulse"
                      aria-hidden
                    />
                  ) : (
                    <StatusIcon className="size-4" aria-hidden />
                  )}
                  <span>{action.label}</span>
                </DropdownMenuItem>
              );
            })}

            {(canEdit || taskBlueprint || statusActions.length > 0) &&
            (canManageRelations || canMove) ? (
              <DropdownMenuSeparator />
            ) : null}

            {canManageRelations ? (
              <>
                <TaskSubtaskMenuItems
                  model={subtaskActions}
                  disabled={actionsDisabled}
                />
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
                                    className="size-4 animate-spin motion-reduce:animate-pulse"
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
                                  {stripInlineMarkdown(link.peerTask.name)}
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
                                  className="size-4 animate-spin motion-reduce:animate-pulse"
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
                                {stripInlineMarkdown(link.peerTask.name)}
                              </span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
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
              taskBlueprint ||
              canManageRelations ||
              canMove) ? (
              <DropdownMenuSeparator />
            ) : null}

            {canArchiveTask ? (
              <DropdownMenuItem
                disabled={actionsDisabled}
                onSelect={handleArchive}
              >
                <Archive className="size-4" aria-hidden />
                {labels.archive}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <TaskReopenToReadyDialog
        open={isReopenDialogOpen}
        onOpenChange={(open) => {
          setIsReopenDialogOpen(open);
          if (!open) {
            setReopenComment("");
          }
        }}
        assigneeName={assigneeName ?? ""}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={() => handleReopenConfirm(TaskStatus.READY)}
        onReopenAsDraft={() => handleReopenConfirm(TaskStatus.DRAFT)}
        isPending={isStatusPending && pendingStatusTarget !== null}
        isDraftPending={
          isStatusPending && pendingStatusTarget === TaskStatus.DRAFT
        }
      />

      {canMove ? (
        <MoveTaskToWorkspaceDialog
          open={isMoveOpen}
          onOpenChange={setIsMoveOpen}
          taskId={taskId}
          currentOrganizationId={currentOrganizationId ?? null}
          organizations={organizations ?? []}
          hasPersonalWorkspace={personalMoveAllowed}
          personalWorkspaceLabel={personalWorkspaceLabel}
        />
      ) : null}

      {sendToChat && chatRooms ? (
        <TaskSendToChatDialog
          taskId={taskId}
          rooms={chatRooms}
          currentUserId={sendToChat.currentUserId}
          onClose={() => setChatRooms(null)}
          // The dialog opens from a menu item, which is gone by then; return
          // to the Actions button the user opened it from.
          onCloseAutoFocus={returnFocusToMenu}
        />
      ) : null}

      {taskBlueprint && repeatOptions ? (
        <TaskScheduleDialog
          initialBlueprint={taskBlueprint}
          coworkerOptions={repeatOptions.coworkerOptions}
          projectOptions={repeatOptions.projectOptions}
          canCreatePrivate={currentOrganizationId != null}
          onClose={() => setRepeatOptions(null)}
          onSaved={(scheduleId) => router.push(taskSchedulePath(scheduleId))}
        />
      ) : null}

      <TaskLinkTaskPickerDialog
        taskId={taskId}
        open={isTaskPickerOpen}
        onOpenChange={(open) => {
          setIsTaskPickerOpen(open);
          if (!open) {
            setSelectedTaskPickerOption(null);
          }
        }}
        selectedOption={selectedTaskPickerOption}
        isLinkPending={isLinkPending}
        onSelectTask={handleSelectLinkableTask}
      />

      {canManageRelations ? (
        <TaskSubtaskMenuDialogs
          model={subtaskActions}
          taskId={taskId}
          assigneeOptions={model.coworkerOptions}
          onCloseAutoFocus={returnFocusToMenu}
        />
      ) : null}

      <TaskCreateRelatedModal model={model} />
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
    case TaskStatus.CANCELED:
      return Ban;
    default:
      return CheckCircle2;
  }
}
