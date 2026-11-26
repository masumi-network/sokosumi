import type { Task } from "@sokosumi/core-client";
import { isTaskEditableStatus } from "@sokosumi/utils";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TaskCreditsUsed } from "@/app/tasks/components/task-credits-used";
import type {
  ProjectResult,
  SessionResult,
} from "@/app/tasks/components/task-detail-view";
import { TaskFromSchedule } from "@/app/tasks/components/task-from-schedule";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskMetadataAssigneeField } from "@/app/tasks/components/task-metadata-assignee-field";
import { TaskMetadataParticipantsField } from "@/app/tasks/components/task-metadata-participants-field";
import { TaskMetadataParticipantsRow } from "@/app/tasks/components/task-metadata-participants-row";
import { TaskMetadataProjectField } from "@/app/tasks/components/task-metadata-project-field";
import { TaskTagCatalogProvider } from "@/app/tasks/components/task-tag-catalog";
import { TaskTagSection } from "@/app/tasks/components/task-tags";
import { buildTaskColumnLabels } from "@/app/tasks/components/tasks-view-labels";
import {
  taskFormAssigneeId,
  withCurrentTaskAssigneeOption,
} from "@/app/tasks/utils/coworker-options";
import type { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import {
  assigneePeopleLock,
  withCurrentProjectOption,
} from "@/app/tasks/utils/task-property-options";
import {
  canCommentOnTaskForViewer,
  isReadOnlyForViewer,
} from "@/app/tasks/utils/task-read-only";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { latestStatusChange } from "@/app/tasks/utils/task-view-model";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { designMdService } from "@/lib/services/design-md.service";

export async function TaskMetadataSection({
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  projectPromise,
  sessionPromise,
  assigneeOptionsPromise,
  projectOptionsPromise,
}: {
  task: Task;
  forceReadOnly: boolean;
  hasAssignedSeatPromise: Promise<boolean>;
  projectPromise: Promise<ProjectResult>;
  sessionPromise: Promise<SessionResult>;
  assigneeOptionsPromise: ReturnType<typeof listTaskAssigneeOptions>;
  /**
   * Projects the Task can move to; the current one is added below. Null when
   * the list failed: the row then stays read-only, not half-filled.
   */
  projectOptionsPromise: Promise<ProjectFilterOption[] | null>;
}) {
  const [project, session, hasAssignedSeat, t, tTasks, tStatus, tPriority] =
    await Promise.all([
      projectPromise,
      sessionPromise,
      hasAssignedSeatPromise,
      getTranslations("App.Tasks.Detail"),
      getTranslations("App.Tasks"),
      getTranslations("App.Tasks.Filters.statusOptions"),
      getTranslations("App.Tasks.Priority"),
    ]);
  const viewer = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? t("memberFallback"),
        // Raw, as Core sends participants: the avatar resolves it.
        image: session.user.image ?? null,
      }
    : null;
  const statusLabels = buildTaskStatusLabels((key) => tStatus(key));
  const isReadOnly = isReadOnlyForViewer({
    forceReadOnly,
    taskStatus: task.status,
    hasAssignedSeat,
  });
  // Core PATCH takes assignee and project only while the Task has not started.
  const canEditAssignment = !isReadOnly && isTaskEditableStatus(task.status);
  const [assigneeOptions, listedProjects, defaultBrand] = canEditAssignment
    ? await Promise.all([
        assigneeOptionsPromise,
        projectOptionsPromise,
        designMdService.resolveEffectiveDesignMd().catch((error: unknown) => {
          unstable_rethrow(error);
          return null;
        }),
      ])
    : [[], [], null];
  const projectOptions = withCurrentProjectOption(
    listedProjects,
    task.projectId ?? null,
    project,
  );

  return (
    <div className="space-y-6">
      <TaskMetadata
        title={t("properties")}
        taskId={task.id}
        editable={!isReadOnly}
        task={{
          status: task.status,
          priority: task.priority,
          dueOn: task.dueOn,
          visibility: task.visibility,
          selectableStatuses: task.selectableStatuses,
          organization: task.organization,
          assignee: task.assignee,
          runAt: task.runAt?.toISOString() ?? null,
          statusSince: latestStatusChange(
            task.events,
            task.createdAt,
          ).toISOString(),
        }}
        project={project ? { id: project.id, name: project.name } : null}
        schedule={
          task.scheduleId ? (
            <Suspense fallback={null}>
              <TaskFromSchedule scheduleId={task.scheduleId} />
            </Suspense>
          ) : null
        }
        credits={
          // Admin and developer views inspect someone else's Task; the
          // ledger read is the viewer's own workspace, so it would mislead.
          forceReadOnly ? null : (
            <Suspense fallback={null}>
              <TaskCreditsUsed taskId={task.id} />
            </Suspense>
          )
        }
        participants={
          // Read-only views (admin, developer) show who takes part, no join.
          viewer && !forceReadOnly ? (
            <TaskMetadataParticipantsField
              key={task.id}
              taskId={task.id}
              viewer={viewer}
              participants={task.participants}
              canJoin={canCommentOnTaskForViewer({
                taskWorkspaceOrganizationId:
                  task.workspace.organizationId ?? null,
                taskOwnerId: task.ownerId,
                sessionUserId: viewer.id,
                forceReadOnly,
                taskStatus: task.status,
                hasAssignedSeat,
              })}
              labels={{
                participants: t("participants"),
                noParticipants: t("noParticipants"),
                joinTask: t("joinTask"),
                leaveTask: t("leaveTask"),
                joinError: t("joinError"),
                leaveError: t("leaveError"),
              }}
            />
          ) : (
            <TaskMetadataParticipantsRow
              participants={task.participants}
              labels={{
                participants: t("participants"),
                noParticipants: t("noParticipants"),
              }}
            />
          )
        }
        assigneeField={
          canEditAssignment ? (
            <TaskMetadataAssigneeField
              key={task.id}
              taskId={task.id}
              assigneeId={taskFormAssigneeId(task)}
              options={withCurrentTaskAssigneeOption(
                assigneeOptions,
                task.assignee,
                {
                  fallbackName: tTasks("personalAssistant"),
                  vendorName: tTasks("sokoBots"),
                },
              )}
              peopleLock={assigneePeopleLock(task)}
              labels={{
                assignee: t("assignee"),
                noAssignee: t("noAssignee"),
              }}
            />
          ) : null
        }
        projectField={
          canEditAssignment && projectOptions ? (
            <TaskMetadataProjectField
              key={task.id}
              taskId={task.id}
              projectId={task.projectId ?? null}
              options={projectOptions}
              context={{
                description: task.description ?? "",
                defaultBrandUrl: defaultBrand?.url ?? null,
                userId: session?.user.id ?? null,
              }}
              labels={{ project: t("project"), noProject: t("noProject") }}
            />
          ) : null
        }
        labels={{
          privateBadge: t("privateBadge"),
          status: t("status"),
          statusLabels,
          organization: t("organization"),
          organizationReadOnly: t("organizationReadOnly"),
          personalWorkspace: t("personalWorkspace"),
          project: t("project"),
          noProject: t("noProject"),
          schedule: t("schedule"),
          startsAt: tTasks("RunAt.title"),
          assignee: t("assignee"),
          noAssignee: t("noAssignee"),
          memberFallback: t("memberFallback"),
          personalAssistantFallback: tTasks("personalAssistant"),
        }}
        priorityLabels={{
          priority: tPriority("title"),
          levels: {
            URGENT: tPriority("levels.URGENT"),
            HIGH: tPriority("levels.HIGH"),
            MEDIUM: tPriority("levels.MEDIUM"),
            LOW: tPriority("levels.LOW"),
            NONE: tPriority("levels.NONE"),
          },
          changePriority: tPriority("change"),
          noPriorityMatches: tPriority("noResults"),
          updateError: tPriority("updateError"),
        }}
        statusFieldLabels={{
          status: t("status"),
          statusLabels,
          columnLabels: buildTaskColumnLabels(tTasks),
          changeStatus: t("actions.changeStatus"),
          noStatusMatches: t("actions.noStatusMatches"),
          reopenToReadyCommentRequired: t(
            "actions.reopenToReadyCommentRequired",
          ),
          updateStatusSuccess: t("actions.updateStatusSuccess"),
          updateStatusError: tTasks("Errors.updateStatus"),
        }}
      />
      <TaskTagCatalogProvider
        organizationId={task.workspace.organizationId ?? null}
        enabled={!forceReadOnly}
      >
        <TaskTagSection
          key={task.updatedAt.toString()}
          tags={task.tags}
          workspaceTags={task.workspaceTags}
          suggestions={task.workspaceTagSuggestions}
          edit={
            isReadOnly
              ? undefined
              : {
                  taskId: task.id,
                  activeOrganizationId: task.workspace.organizationId ?? null,
                }
          }
        />
      </TaskTagCatalogProvider>
    </div>
  );
}
