"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  isOtherHumanAssignee,
  resolveTaskAssigneeFields,
} from "@/app/tasks/utils/coworker-options";
import { getPendingTaskName } from "@/app/tasks/utils/pending-created-task";
import { isAgentAssigneeFields } from "@/app/tasks/utils/task-form-status";
import { taskHref } from "@/app/tasks/utils/task-href";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { withBoardPreview } from "@/hooks/effects/use-pending-created-tasks";
import { updateTask } from "@/lib/actions/task/action";
import { toTaskContextSelectionInput } from "./task-context-attachments";

import type { useTaskFormModel } from "./use-task-form-model";
export function useTaskFormSubmission(
  model: ReturnType<typeof useTaskFormModel>,
) {
  const {
    mode,
    labels,
    coworkerOptions,
    taskId,
    initialValues,
    onSuccess,
    onCreated,
    onCreateTask,
    router,
    session,
    canCreatePrivateTask,
    tRunAt,
    tNewTask,
    hasProjectSelection,
    shouldShowProjectSelect,
    originalStatus,
    copyOfTaskId,
    isCopy,
    workspaceSelection,
    name,
    isPrivate,
    projectId,
    setIsProjectMissing,
    contextSelection,
    description,
    knownSokoBotId,
    assigneeId,
    initialRunAt,
    runAt,
    status,
    setIsSubmitting,
    setSubmittedTagReceipt,
    setCreatedTask,
    runAtLabel,
    isSaveDisabled,
    useWizard,
    step,
    canUseSubmitShortcut,
    draftTags,
  } = model;
  const {
    workspaceTagIds,
    dismissedWorkspaceTagIds,
    dismissedTopicIds,
    expectedWorkspaceTagIds,
    reportConflict,
  } = workspaceSelection;
  const handleSave = useCallback(async () => {
    if (isSaveDisabled || (useWizard && step === 1)) return;
    if (
      shouldShowProjectSelect &&
      projectId === undefined &&
      labels.projectRequired
    ) {
      setIsProjectMissing(true);
      return;
    }
    // Edit sends the Run at only when it changed. A time that passed while
    // the form sat open would be refused by Core, so say so before sending.
    const sendsRunAt =
      runAt !== null && (mode === "create" || runAt !== initialRunAt);
    if (sendsRunAt && new Date(runAt) <= new Date()) {
      toast.error(tRunAt("notInFuture"));
      return;
    }
    const tagSuggestionReceipt = draftTags.tagSuggestionReceipt;
    setSubmittedTagReceipt(tagSuggestionReceipt);
    setIsSubmitting(true);
    // Set while a create is out: its failure names the Task that is not made.
    let createFailedMessage: string | null = null;
    try {
      const trimmedDescription = description.trim();
      const trimmedName = name.trim();
      const context = toTaskContextSelectionInput(contextSelection);
      const assigneeFields = resolveTaskAssigneeFields(
        assigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      if (
        mode === "create" &&
        (status === TaskStatus.DRAFT ||
          status === TaskStatus.READY ||
          status === TaskStatus.QUEUED)
      ) {
        const createTaskHandler = withBoardPreview(onCreateTask);
        const isOtherHuman = isOtherHumanAssignee(
          assigneeFields.assigneeUserId,
          session?.user.id,
        );
        // A copy never turns public on its own: with another person assigned
        // it still asks for Private, and Core refuses instead of publishing.
        const sendsPrivate =
          canCreatePrivateTask && isPrivate && (!isOtherHuman || isCopy);
        createFailedMessage = tNewTask("createError", {
          name:
            getPendingTaskName({
              name: trimmedName,
              description: trimmedDescription,
            }) ?? labels.untitledTask,
        });
        // The brief copies in other Projects reuse. Context is only which
        // Project files to attach, so each copy reads its own Project's.
        // Tags, status and Run at stay with this Task.
        const brief = {
          ...(trimmedName ? { name: trimmedName } : {}),
          description: trimmedDescription,
          ...assigneeFields,
          ...(sendsPrivate
            ? {
                visibility: "PRIVATE" as const,
                ...(isOtherHuman ? {} : { assigneeUserId: null }),
              }
            : {}),
          context,
        };
        const result = await createTaskHandler({
          ...(workspaceTagIds ? { workspaceTagIds } : {}),
          ...(dismissedWorkspaceTagIds ? { dismissedWorkspaceTagIds } : {}),
          ...(dismissedTopicIds ? { dismissedTopicIds } : {}),
          ...(tagSuggestionReceipt ? { tagSuggestionReceipt } : {}),
          ...(copyOfTaskId ? { copyOfTaskId } : {}),
          ...brief,
          ...(hasProjectSelection ? { projectId } : {}),
          status,
          ...(runAt ? { runAt } : {}),
        });
        if (!result.ok) {
          toast.error(createFailedMessage);
          return;
        }
        createFailedMessage = null;
        const createdTask = result.value;
        const createdHref = taskHref({
          id: createdTask.taskId,
          identifier: createdTask.identifier,
          name: createdTask.name.trim() || labels.untitledTask,
        });
        // Confirm success in place and let the user choose when to navigate;
        // the redirect target is prefetched so it lands fast.
        router.prefetch(createdHref);
        setCreatedTask({
          id: createdTask.taskId,
          identifier: createdTask.identifier,
          name: createdTask.name.trim() || labels.untitledTask,
          status,
          statusLabel:
            status === TaskStatus.QUEUED
              ? labels.statusQueued
              : status === TaskStatus.DRAFT
                ? labels.statusDraft
                : labels.statusReady,
          scheduleLabel: runAtLabel ?? undefined,
          brief,
          projectId: hasProjectSelection ? (projectId ?? null) : null,
        });
        onCreated?.(createdTask.taskId);
        return;
      }

      if (!taskId) {
        throw new Error("Task ID is required");
      }

      const result = await updateTask({
        taskId,
        ...(workspaceTagIds
          ? { workspaceTagIds, expectedWorkspaceTagIds }
          : {}),
        ...(dismissedWorkspaceTagIds ? { dismissedWorkspaceTagIds } : {}),
        ...(dismissedTopicIds ? { dismissedTopicIds } : {}),
        name: trimmedName,
        description: trimmedDescription,
        ...assigneeFields,
        ...(hasProjectSelection ? { projectId } : {}),
        context,
        desiredStatus: status,
        ...(runAt !== initialRunAt &&
        (runAt !== null ||
          status === TaskStatus.DRAFT ||
          !isAgentAssigneeFields(assigneeFields))
          ? { runAt }
          : {}),
      });
      if (!result.ok) {
        if (
          result.error.kind === CORE_API_ERROR_KINDS.TASK_WORKSPACE_TAGS_CHANGED
        ) {
          reportConflict();
          return;
        }
        toast.error(labels.saveError);
        return;
      }
      if (onSuccess) {
        onSuccess({ id: taskId, identifier: null, name: trimmedName });
        return;
      }
      router.push(`/tasks/${taskId}`);
    } catch (error) {
      console.error("Failed to save task", error);
      toast.error(createFailedMessage ?? labels.saveError);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    draftTags.tagSuggestionReceipt,
    expectedWorkspaceTagIds,
    reportConflict,
    dismissedWorkspaceTagIds,
    dismissedTopicIds,
    workspaceTagIds,
    copyOfTaskId,
    isCopy,
    description,
    isSaveDisabled,
    mode,
    step,
    useWizard,
    name,
    assigneeId,
    coworkerOptions,
    knownSokoBotId,
    initialValues?.assigneeUserId,
    projectId,
    hasProjectSelection,
    shouldShowProjectSelect,
    originalStatus,
    router,
    status,
    taskId,
    onSuccess,
    onCreated,
    onCreateTask,
    runAt,
    initialRunAt,
    runAtLabel,
    contextSelection,
    canCreatePrivateTask,
    isPrivate,
    session?.user.id,
    labels.projectRequired,
    labels.statusDraft,
    labels.statusQueued,
    labels.statusReady,
    labels.saveError,
    labels.untitledTask,
    tNewTask,
    tRunAt,
  ]);

  useEventListener("window", "keydown", (event) => {
    if (event.defaultPrevented) return;
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      canUseSubmitShortcut
    ) {
      event.preventDefault();
      void handleSave();
    }
  });

  return handleSave;
}
