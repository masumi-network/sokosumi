import type { Task } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TaskCreditsUsed } from "@/app/tasks/components/task-credits-used";
import type {
  ProjectResult,
  SessionResult,
} from "@/app/tasks/components/task-detail-view";
import { TaskFromSchedule } from "@/app/tasks/components/task-from-schedule";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskMetadataFollowersRow } from "@/app/tasks/components/task-metadata-followers-row";
import { TaskMetadataParticipantsRow } from "@/app/tasks/components/task-metadata-participants-row";
import { TaskTagSection } from "@/app/tasks/components/task-tags";
import { isReadOnlyForViewer } from "@/app/tasks/utils/task-read-only";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { latestStatusChange } from "@/app/tasks/utils/task-view-model";

export async function TaskMetadataSection({
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  projectPromise,
  sessionPromise,
}: {
  task: Task;
  forceReadOnly: boolean;
  hasAssignedSeatPromise: Promise<boolean>;
  projectPromise: Promise<ProjectResult>;
  sessionPromise: Promise<SessionResult>;
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
  const statusLabels = buildTaskStatusLabels((key) => tStatus(key));
  const isReadOnly = isReadOnlyForViewer({
    forceReadOnly,
    taskStatus: task.status,
    hasAssignedSeat,
  });

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
          <>
            <TaskMetadataParticipantsRow
              participants={task.participants}
              labels={{
                participants: t("participants"),
                noParticipants: t("noParticipants"),
              }}
            />
            <TaskMetadataFollowersRow
              followers={task.followers ?? []}
              viewerId={session?.user.id ?? null}
              labels={{
                followedBy: t("followedBy"),
                followerBot: (name) => t("followerBot", { name }),
              }}
            />
          </>
        }
        labels={{
          privateBadge: t("privateBadge"),
          status: t("status"),
          statusLabels,
          organization: t("organization"),
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
          changeStatus: t("actions.changeStatus"),
          noStatusMatches: t("actions.noStatusMatches"),
          reopenToReadyTitle: t("actions.reopenToReadyTitle"),
          reopenToReadyDescription: t("actions.reopenToReadyDescription"),
          reopenToReadyCommentLabel: t("actions.reopenToReadyCommentLabel"),
          reopenToReadyCommentPlaceholder: t(
            "actions.reopenToReadyCommentPlaceholder",
          ),
          reopenToReadyCommentRequired: t(
            "actions.reopenToReadyCommentRequired",
          ),
          reopenToReadyConfirm: t("actions.reopenToReadyConfirm"),
          cancel: t("actions.cancel"),
          updateStatusSuccess: t("actions.updateStatusSuccess"),
          updateStatusError: tTasks("Errors.updateStatus"),
        }}
      />
      <TaskTagSection key={task.updatedAt.toString()} tags={task.tags} />
    </div>
  );
}
