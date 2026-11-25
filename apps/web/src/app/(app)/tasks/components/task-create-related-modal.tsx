"use client";

import { toast } from "sonner";
import { taskHref } from "@/app/tasks/utils/task-href";
import { createTaskAndLink } from "@/lib/actions/task/action";
import { TaskForm } from "./task-form";
import { TaskFormModal } from "./task-form-modal";

import type { useTaskDetailActions } from "./use-task-detail-actions";
export function TaskCreateRelatedModal({
  model,
}: {
  model: ReturnType<typeof useTaskDetailActions>;
}) {
  const {
    taskId,
    coworkerOptions,
    agentNameById,
    defaultAssigneeId,
    assigneeKind,
    initialDesignMdAttachment,
    tDetailActions,
    router,
    selectedCreateRelatedOption,
    setSelectedCreateRelatedOption,
    isCreateRelatedOpen,
    setIsCreateRelatedOpen,
    isCreateRelatedDismissDisabled,
    setIsCreateRelatedDismissDisabled,
    createTaskLabels,
  } = model;
  return selectedCreateRelatedOption ? (
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
      variant="composer"
    >
      <TaskForm
        mode="create"
        showCancel={false}
        labels={createTaskLabels}
        coworkerOptions={coworkerOptions}
        agentNameById={agentNameById}
        initialDesignMdAttachment={initialDesignMdAttachment}
        initialValues={
          defaultAssigneeId
            ? assigneeKind === "human"
              ? { assigneeUserId: defaultAssigneeId }
              : { assigneeId: defaultAssigneeId }
            : undefined
        }
        onCreateTask={async ({
          description,
          name,
          tagSuggestionReceipt,
          workspaceTagIds,
          dismissedWorkspaceTagIds,
          dismissedTopicIds,
          assigneeId,
          assigneeSokoBotId,
          assigneeUserId,
          projectId,
          status,
          runAt,
          context,
          visibility,
          priority,
          dueOn,
        }) => {
          const result = await createTaskAndLink({
            taskId,
            description,
            name,
            tagSuggestionReceipt,
            workspaceTagIds,
            dismissedWorkspaceTagIds,
            dismissedTopicIds,
            assigneeId,
            assigneeSokoBotId,
            assigneeUserId: assigneeUserId ?? null,
            projectId,
            status,
            runAt,
            context,
            visibility,
            priority,
            dueOn,
            relation: selectedCreateRelatedOption.relation,
          });

          if (!result.ok) {
            return result;
          }

          return {
            ok: true,
            value: {
              taskId: result.value.createdTaskId,
              name: result.value.name,
              identifier: result.value.identifier,
            },
          };
        }}
        onSubmittingChange={setIsCreateRelatedDismissDisabled}
        onCancel={() => {
          setIsCreateRelatedOpen(false);
          setSelectedCreateRelatedOption(null);
        }}
        onCreated={() => {
          toast.success(tDetailActions("createRelatedSuccess"));
        }}
        onSuccess={(createdTask) => {
          setIsCreateRelatedOpen(false);
          setSelectedCreateRelatedOption(null);
          router.push(taskHref(createdTask));
        }}
      />
    </TaskFormModal>
  ) : null;
}
