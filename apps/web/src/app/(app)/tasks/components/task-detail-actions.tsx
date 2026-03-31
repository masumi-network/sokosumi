"use client";

import { type MemberWithOrganization } from "@sokosumi/database";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Ellipsis,
  FlagTriangleRight,
  Link2,
  Loader2,
  LucideSquareMousePointer,
  OctagonMinus,
  Pencil,
  RotateCcw,
  ListX,
  SquareMinus,
  SquareMousePointer,
  SquarePlus,
  Trash,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  createTaskAndLink,
  createTaskLink,
  deleteTask,
  deleteTaskLink,
  setTaskStatusFromDrag,
} from "@/lib/actions/task/action";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { TaskShare } from "@/lib/clients/generated/core";
import {
  type TaskLink,
  TaskLinkRelation,
  type TaskLinkRelation as TaskLinkRelationValue,
} from "@/lib/clients/generated/core/types.gen";
import type { CoworkerOption } from "@/lib/types/coworker";

import { MoveTaskToWorkspaceDialog } from "./move-task-to-workspace-dialog";
import {
  getTaskLinkActionInput,
  mapTaskListItemToTaskPickerTask,
  TASK_STATUS,
  type TaskPickerTask,
  type TaskStatus,
} from "./task-detail-api-types";
import { TaskForm, type TaskFormLabels } from "./task-form";
import { TaskFormModal } from "./task-form-modal";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";
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
  taskLinks: TaskLink[];
  coworkerOptions: CoworkerOption[];
  agentNameById: Map<string, string>;
  defaultCoworkerId?: string | null;
  actionsMenuLabel: string;
  labels: TaskDetailActionsLabels;
  currentOrganizationId?: string | null;
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel: string;
}

interface TaskLinkActionOption {
  id: string;
  label: string;
  relation: TaskLinkRelationValue;
  icon: LucideIcon;
}

const TASK_PICKER_PAGE_SIZE = 20;

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
}: TaskDetailActionsProps) {
  const tApp = useTranslations("App");
  const tDetailActions = useTranslations("App.Tasks.Detail.actions");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const tTasks = useTranslations("App.Tasks");
  const router = useRouter();
  const [isStatusPending, startStatusTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isLinkPending, startLinkTransition] = useTransition();
  const [isParentRemovalPending, startParentRemovalTransition] =
    useTransition();
  const [isRemoveRelatedPending, startRemoveRelatedTransition] =
    useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [selectedTaskPickerOption, setSelectedTaskPickerOption] =
    useState<TaskLinkActionOption | null>(null);
  const [selectedCreateRelatedOption, setSelectedCreateRelatedOption] =
    useState<TaskLinkActionOption | null>(null);
  const [isCreateRelatedOpen, setIsCreateRelatedOpen] = useState(false);
  const [isCreateRelatedDismissDisabled, setIsCreateRelatedDismissDisabled] =
    useState(false);
  const [pendingStatusTarget, setPendingStatusTarget] =
    useState<TaskStatus | null>(null);
  const [pendingLinkTaskId, setPendingLinkTaskId] = useState<string | null>(
    null,
  );
  const [pendingRemoveLinkId, setPendingRemoveLinkId] = useState<string | null>(
    null,
  );
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [debouncedTaskPickerQuery, setDebouncedTaskPickerQuery] = useState("");
  const [taskPickerResults, setTaskPickerResults] = useState<TaskPickerTask[]>(
    [],
  );
  const [taskPickerNextCursor, setTaskPickerNextCursor] = useState<
    string | null
  >(null);
  const [taskPickerError, setTaskPickerError] = useState<string | null>(null);
  const [isTaskPickerLoading, setIsTaskPickerLoading] = useState(false);
  const [isTaskPickerLoadingMore, setIsTaskPickerLoadingMore] = useState(false);
  const taskPickerRequestIdRef = useRef(0);

  const statusActions = getTaskStatusActions(status, labels);

  const canEditOrDelete =
    status === TASK_STATUS.DRAFT || status === TASK_STATUS.READY;
  const isFinalized =
    status === TASK_STATUS.COMPLETED ||
    status === TASK_STATUS.FAILED ||
    status === TASK_STATUS.CANCELED ||
    status === TASK_STATUS.CANCEL_REQUESTED;
  const canManageRelations = !isFinalized;
  const canMove =
    !isFinalized &&
    jobsCount === 0 &&
    getWorkspaceMoveTargetCount(currentOrganizationId, organizations) > 0;
  const currentParentLink = taskLinks.find((link) => link.relation === "child");
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
  const canRemoveParent =
    canManageRelations && typeof currentParentLink !== "undefined";
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
    coworker: tNewTask("coworker"),
    coworkerDescription: tNewTask("coworkerDescription"),
    status: tNewTask("status"),
    statusDescription: tNewTask("statusDescription"),
    statusDraft: tNewTask("statusDraft"),
    statusReady: tNewTask("statusReady"),
    back: tNewTask("back"),
    uploadFile: tNewTask("uploadFile"),
    uploadFileError: tNewTask("uploadFileError"),
    removeAttachment: tNewTask("removeAttachment"),
    submit: tNewTask("saveDraft"),
    saveAsDraft: tNewTask("saveAsDraft"),
    createTask: tNewTask("createTask"),
    cancel: tNewTask("cancel"),
    ctrl: tNewTask("ctrl"),
  };

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
        const linkInput = getTaskLinkActionInput(option.relation);
        await createTaskLink({
          taskId,
          relatedTaskId,
          ...linkInput,
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
    if (!currentParentLink) return;

    startParentRemovalTransition(async () => {
      try {
        await deleteTaskLink({
          taskId,
          linkId: currentParentLink.id,
        });
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
    isDeletePending ||
    isLinkPending ||
    isParentRemovalPending ||
    isRemoveRelatedPending;

  const loadTaskPickerTasks = useEffectEvent(
    async ({
      query,
      cursor,
      append,
    }: {
      query: string;
      cursor?: string | null;
      append: boolean;
    }) => {
      const requestId = ++taskPickerRequestIdRef.current;

      if (append) {
        setIsTaskPickerLoadingMore(true);
      } else {
        setIsTaskPickerLoading(true);
      }

      setTaskPickerError(null);

      try {
        const response = await coreClient.getTasks({
          q: query || undefined,
          cursor: cursor ?? undefined,
          limit: TASK_PICKER_PAGE_SIZE,
          scope: ["owned"],
        });

        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        const nextTasks = response.data
          .map(mapTaskListItemToTaskPickerTask)
          .filter((taskOption) => taskOption.id !== taskId);

        setTaskPickerResults((currentResults) =>
          append ? [...currentResults, ...nextTasks] : nextTasks,
        );
        setTaskPickerNextCursor(response.meta?.pagination?.nextCursor ?? null);
      } catch (_error) {
        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        const message = append
          ? tDetailActions("taskPickerLoadMoreError")
          : tDetailActions("taskPickerError");

        if (!append) {
          setTaskPickerResults([]);
          setTaskPickerNextCursor(null);
        }

        setTaskPickerError(message);
      } finally {
        if (requestId !== taskPickerRequestIdRef.current) {
          return;
        }

        if (append) {
          setIsTaskPickerLoadingMore(false);
        } else {
          setIsTaskPickerLoading(false);
        }
      }
    },
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedTaskPickerQuery(taskPickerQuery.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [taskPickerQuery]);

  useEffect(() => {
    if (!isTaskPickerOpen) {
      return;
    }

    void loadTaskPickerTasks({
      query: debouncedTaskPickerQuery,
      append: false,
    });
  }, [debouncedTaskPickerQuery, isTaskPickerOpen]);

  const handleLoadMoreTaskOptions = () => {
    if (
      !taskPickerNextCursor ||
      isTaskPickerLoadingMore ||
      isTaskPickerLoading
    ) {
      return;
    }

    void loadTaskPickerTasks({
      query: debouncedTaskPickerQuery,
      cursor: taskPickerNextCursor,
      append: true,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <TaskShareButton
        task={{ id: taskId, share }}
        label={labels.share}
        variant="ghost"
        size="icon"
        className="size-7"
      />
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
                className="cursor-pointer"
                key={action.target}
                disabled={actionsDisabled}
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

          {statusActions.length > 0 &&
          (canEditOrDelete || canManageRelations || canMove) ? (
            <DropdownMenuSeparator />
          ) : null}

          {canEditOrDelete ? (
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
              {canRemoveRelated ? (
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
                                link.relation === TaskLinkRelation.BLOCKED_BY
                                  ? "text-destructive size-4"
                                  : "size-4"
                              }
                              aria-hidden
                            />
                          )}
                          <span className="truncate">{link.peerTask.name}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {canRemoveParent ? (
                <DropdownMenuItem
                  disabled={actionsDisabled}
                  onSelect={handleRemoveParent}
                >
                  {isParentRemovalPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Unlink className="size-4" aria-hidden />
                  )}
                  {tDetailActions("removeParent")}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}

          {(canEditOrDelete || canManageRelations) && canMove ? (
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

          {canEditOrDelete &&
          (statusActions.length > 0 || canManageRelations || canMove) ? (
            <DropdownMenuSeparator />
          ) : null}

          {canEditOrDelete ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={actionsDisabled}
              onSelect={() => setIsOpen(true)}
            >
              <Trash className="size-4" aria-hidden />
              {labels.delete}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

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

      <CommandDialog
        open={isTaskPickerOpen}
        onOpenChange={(open) => {
          setIsTaskPickerOpen(open);
          if (!open) {
            setPendingLinkTaskId(null);
            setSelectedTaskPickerOption(null);
            setTaskPickerQuery("");
            setDebouncedTaskPickerQuery("");
            setTaskPickerResults([]);
            setTaskPickerNextCursor(null);
            setTaskPickerError(null);
            setIsTaskPickerLoading(false);
            setIsTaskPickerLoadingMore(false);
            taskPickerRequestIdRef.current += 1;
          }
        }}
        title={tDetailActions("taskPickerTitle", {
          relation: selectedTaskPickerOption?.label ?? "",
        })}
        description={tDetailActions("taskPickerDescription")}
      >
        <CommandInput
          placeholder={tDetailActions("taskPickerSearchPlaceholder")}
          value={taskPickerQuery}
          onValueChange={setTaskPickerQuery}
        />
        <CommandList>
          {isTaskPickerLoading && taskPickerResults.length === 0 ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {tDetailActions("taskPickerLoading")}
            </div>
          ) : null}

          {!isTaskPickerLoading &&
          taskPickerError &&
          taskPickerResults.length === 0 ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-sm">
              {taskPickerError}
            </div>
          ) : null}

          {!isTaskPickerLoading &&
          !taskPickerError &&
          taskPickerResults.length === 0 ? (
            <CommandEmpty>{tDetailActions("taskPickerEmpty")}</CommandEmpty>
          ) : null}

          {taskPickerResults.length > 0 ? (
            <CommandGroup heading={selectedTaskPickerOption?.label}>
              {taskPickerResults.map((taskOption) => {
                const PickerIcon = selectedTaskPickerOption?.icon ?? Link2;

                return (
                  <CommandItem
                    key={taskOption.id}
                    value={`${taskOption.name} ${taskOption.id}`}
                    disabled={isLinkPending}
                    onSelect={() => {
                      if (!selectedTaskPickerOption) return;
                      handleSelectLinkableTask(
                        selectedTaskPickerOption,
                        taskOption.id,
                      );
                    }}
                  >
                    {isLinkPending && pendingLinkTaskId === taskOption.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <PickerIcon className="size-4" aria-hidden />
                    )}
                    <span>{taskOption.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {taskPickerResults.length > 0 && taskPickerError ? (
            <div className="text-muted-foreground px-2 py-3 text-sm">
              {taskPickerError}
            </div>
          ) : null}

          {taskPickerNextCursor ? (
            <CommandItem
              value="load-more"
              disabled={isTaskPickerLoadingMore || isTaskPickerLoading}
              onSelect={handleLoadMoreTaskOptions}
            >
              {isTaskPickerLoadingMore ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Link2 className="size-4" aria-hidden />
              )}
              <span>{tDetailActions("taskPickerLoadMore")}</span>
            </CommandItem>
          ) : null}
        </CommandList>
      </CommandDialog>

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
            onCreateTask={async ({ description, coworkerId, status }) => {
              const linkInput = getTaskLinkActionInput(
                selectedCreateRelatedOption.relation,
              );
              const result = await createTaskAndLink({
                taskId,
                description,
                coworkerId,
                status,
                ...linkInput,
              });

              return { taskId: result.createdTaskId };
            }}
            onSubmittingChange={setIsCreateRelatedDismissDisabled}
            onCancel={() => {
              setIsCreateRelatedOpen(false);
              setSelectedCreateRelatedOption(null);
            }}
            onSuccess={() => {
              setIsCreateRelatedOpen(false);
              setSelectedCreateRelatedOption(null);
              router.refresh();
              toast.success(tDetailActions("createRelatedSuccess"));
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
    case TASK_STATUS.DRAFT:
      return RotateCcw;
    case TASK_STATUS.READY:
      return CheckCircle2;
    case TASK_STATUS.CANCEL_REQUESTED:
      return Ban;
    default:
      return CheckCircle2;
  }
}

function getTaskStatusActions(
  status: TaskStatus,
  labels: TaskDetailActionsLabels,
) {
  if (status === TASK_STATUS.CANCELED) {
    return [
      { label: labels.revertToDraft, target: TASK_STATUS.DRAFT },
      { label: labels.markAsReady, target: TASK_STATUS.READY },
    ];
  }

  if (status === TASK_STATUS.DRAFT) {
    return [{ label: labels.markAsReady, target: TASK_STATUS.READY }];
  }

  if (status === TASK_STATUS.READY) {
    return [{ label: labels.revertToDraft, target: TASK_STATUS.DRAFT }];
  }

  if (
    status === TASK_STATUS.INPUT_REQUIRED ||
    status === TASK_STATUS.AUTHENTICATION_REQUIRED ||
    status === TASK_STATUS.OUT_OF_CREDITS ||
    status === TASK_STATUS.CREDITS_TOPPED_UP ||
    status === TASK_STATUS.RUNNING
  ) {
    return [
      {
        label: labels.cancelRequest,
        target: TASK_STATUS.CANCEL_REQUESTED,
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
