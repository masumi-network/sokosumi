import type { Task } from "@sokosumi/core-client";
import {
  resolveIpfsOrHttpUrl,
  type SubscriptionPlanName,
} from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import {
  type MentionableUser,
  TaskActivitySection,
} from "@/app/tasks/components/task-activity";
import { TaskActivitySubscribeControl } from "@/app/tasks/components/task-activity-subscribe";
import type {
  AgentsResult,
  SessionResult,
} from "@/app/tasks/components/task-detail-view";
import { TaskFollowControl } from "@/app/tasks/components/task-follow-control";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { buildTaskActivityActors } from "@/app/tasks/utils/task-activity-actors";
import { taskActivityFeedFromEvents } from "@/app/tasks/utils/task-activity-feed";
import { canCommentOnTaskForViewer } from "@/app/tasks/utils/task-read-only";

export async function TaskActivitySectionContent({
  taskId,
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  agentsPromise,
  sessionPromise,
  currentPlanPromise,
  mentionableUsersPromise,
  viewerHasSokoBotPromise,
}: {
  taskId: string;
  task: Task;
  forceReadOnly: boolean;
  hasAssignedSeatPromise: Promise<boolean>;
  agentsPromise: Promise<AgentsResult>;
  sessionPromise: Promise<SessionResult>;
  currentPlanPromise: Promise<SubscriptionPlanName | null>;
  mentionableUsersPromise: Promise<MentionableUser[]>;
  viewerHasSokoBotPromise: Promise<boolean>;
}) {
  const [
    agents,
    session,
    viewerPlan,
    hasAssignedSeat,
    mentionableUsers,
    viewerHasSokoBot,
    t,
  ] = await Promise.all([
    agentsPromise,
    sessionPromise,
    currentPlanPromise,
    hasAssignedSeatPromise,
    mentionableUsersPromise,
    viewerHasSokoBotPromise,
    getTranslations("App.Tasks.Detail"),
  ]);
  // The task payload already carries every event, so a second events read
  // only repeats it. Read-only (admin and developer views) keeps every
  // comment: the viewer is outside the task's workspace, so the
  // workspace-scoped read that loads older comments 404s.
  const activityEvents = taskActivityFeedFromEvents(task.events, {
    keepAllComments: forceReadOnly,
  });
  const {
    userById: actorsUserById,
    coworkerById,
    sokoBotById,
  } = buildTaskActivityActors({
    ...task,
    events: activityEvents.events,
  });
  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "User",
        image: session.user.image
          ? resolveIpfsOrHttpUrl(session.user.image)
          : null,
      }
    : null;
  // Participants resolve `@` names in comments even after they leave the workspace.
  const participantUserById = Object.fromEntries(
    task.participants.map(({ user }) => [
      user.id,
      {
        name: user.name,
        image: user.image ? resolveIpfsOrHttpUrl(user.image) : null,
      },
    ]),
  );
  const knownUserById = { ...participantUserById, ...actorsUserById };
  const userById = currentUser
    ? {
        ...knownUserById,
        [currentUser.id]: {
          name: currentUser.name,
          image: currentUser.image,
        },
      }
    : knownUserById;
  const agentNameById = buildAgentNameById(agents);
  const canComment = canCommentOnTaskForViewer({
    taskWorkspaceOrganizationId: task.workspace.organizationId ?? null,
    taskOwnerId: task.ownerId,
    sessionUserId: session?.user.id,
    forceReadOnly,
    taskStatus: task.status,
    hasAssignedSeat,
  });

  return (
    <TaskActivitySection
      key={taskId}
      taskId={taskId}
      title={t("activity")}
      placeholder={t("commentPlaceholder")}
      submitLabel={t("submit")}
      actorCoworkerLabel={t("actorCoworker")}
      actorUserLabel={t("actorUser")}
      actorSokoBotLabel={t("actorSokoBot")}
      actorSystemLabel={t("actorSystem")}
      actionCommentedLabel={t("actionCommented")}
      actionUpdatedStatusLabel={t("actionUpdatedStatus")}
      actionCreatedTaskLabel={t("actionCreatedTask")}
      taskOwnerId={task.ownerId}
      events={activityEvents.events}
      commentCount={activityEvents.pagination.commentCount}
      latestCommentId={activityEvents.pagination.latestCommentId}
      taskFiles={task.files}
      agentNameById={agentNameById}
      userById={userById}
      coworkerById={coworkerById}
      sokoBotById={sokoBotById}
      currentUser={currentUser}
      expandLabel={t("expand")}
      collapseLabel={t("collapse")}
      viewerPlan={viewerPlan}
      mentionableUsers={mentionableUsers.map(({ id, name }) => ({ id, name }))}
      canComment={canComment}
      headerAction={
        <>
          <TaskFollowControl
            taskId={taskId}
            // Read-only views offer no follow.
            viewerId={forceReadOnly ? null : (currentUser?.id ?? null)}
            viewerHasSokoBot={viewerHasSokoBot}
            followers={task.followers ?? []}
            canComment={canComment}
          />
          <TaskActivitySubscribeControl
            taskId={taskId}
            // Read-only views show who takes part, with no join or leave.
            viewerId={forceReadOnly ? null : (currentUser?.id ?? null)}
            viewerName={currentUser?.name ?? null}
            viewerImage={currentUser?.image ?? null}
            participants={task.participants}
            canComment={canComment}
          />
        </>
      }
    />
  );
}
