import {
  hasActiveTaskSchedule,
  resolveIpfsOrHttpUrl,
  type SubscriptionPlanName,
} from "@sokosumi/utils";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskFiles } from "@/app/tasks/components/task-files";
import { TaskJobs } from "@/app/tasks/components/task-jobs";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";
import { TaskVendorGrantApprovalBanner } from "@/app/tasks/components/task-vendor-grant-approval-banner";
import { TaskVendorGrantPendingInfoBanner } from "@/app/tasks/components/task-vendor-grant-pending-info-banner";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/list-task-assignee-member-options";
import { buildTaskActivityActors } from "@/app/tasks/utils/task-activity-actors";
import { resolveTaskDetailViewerPlan } from "@/app/tasks/utils/task-activity-plan";
import { coworkerNameFromCoreAssignee } from "@/app/tasks/utils/task-assignee";
import {
  canCancelTaskForViewer,
  canCommentOnTaskForViewer,
  isReadOnlyForViewer,
} from "@/app/tasks/utils/task-read-only";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import { getSession } from "@/lib/auth/auth.server";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { hasAssignedOrganizationSeat } from "@/lib/services/organization-assigned-seat.service";
import { projectService } from "@/lib/services/project.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";
import { formatShortDateTime } from "@/lib/utils/datetime";
import {
  buildVendorGrantReviewHref,
  canApproveVendorGrants,
  resolveViewerOrganizationMembership,
} from "@/lib/utils/vendor-grant-approval";

type SessionResult = Awaited<ReturnType<typeof getSession>>;
type AgentsResult = Awaited<
  ReturnType<typeof agentService.getAvailableAgentsWithCreditsPrice>
>;
type CoworkersResult = Awaited<
  ReturnType<typeof coworkerService.listCoworkers>
>;
type MembersResult = Awaited<
  ReturnType<typeof userService.getMyMembersWithOrganizations>
>;

interface TaskDetailViewProps {
  task: Task;
  /**
   * Forces the view into read-only mode regardless of ownership. Used by the
   * admin task detail page, where the viewer is never the owner and must not be
   * able to edit, comment, or mutate the task.
   */
  forceReadOnly?: boolean;
  /**
   * Renders {@link AutoContextSwitch} so the active workspace follows the task.
   * Only safe when the viewer is guaranteed to be a member of the task's
   * workspace (the user-facing route). The admin route leaves this off — admins
   * read tasks in workspaces they are not part of, where switching would fail or
   * be wrong.
   */
  enableAutoSwitch?: boolean;
}

/**
 * Read-only-capable task detail view shared by the user-facing
 * `/tasks/[taskId]` route and the admin `/admin/tasks/[taskId]` route. The user
 * route loads the task through the workspace-scoped Core read; the admin route
 * loads it through the admin-only endpoint and passes `forceReadOnly`.
 */
export async function TaskDetailView({
  task,
  forceReadOnly = false,
  enableAutoSwitch = false,
}: TaskDetailViewProps) {
  const taskId = task.id;
  const coworkersPromise = coworkerService.listCoworkers().catch(() => []);
  const agentsPromise = agentService.getAvailableAgentsWithCreditsPrice();
  const membersPromise = userService.getMyMembersWithOrganizations();
  const workspaceAccessPromise = userService.getWorkspaceAccess();
  const sessionPromise = getSession();
  const localePromise = getLocale();
  // Admin read-only: plan is unavailable for the viewer (not "free"). Skip the
  // org subscription call that used to 403 → auth-redirect bounce.
  const currentPlanPromise = sessionPromise.then((session) =>
    resolveTaskDetailViewerPlan(forceReadOnly, session, task.organizationId),
  );
  const hasAssignedSeatPromise = forceReadOnly
    ? Promise.resolve(false)
    : hasAssignedOrganizationSeat(task.workspace.organizationId ?? null);
  const translationsPromise = getTranslations("App.Tasks.Detail");
  const linkedTasks = mapVisibleTaskLinks(task.links);
  const parentTask = linkedTasks.find(
    (link) => link.relation === "child" || link.relation === "schedule_series",
  );

  const t = await translationsPromise;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl pb-8 md:px-4">
        <Suspense fallback={null}>
          <TaskDetailRealtimeListener
            taskId={taskId}
            sessionPromise={sessionPromise}
          />
        </Suspense>
        {enableAutoSwitch ? (
          <Suspense fallback={null}>
            <TaskDetailAutoSwitch
              targetOrganizationId={task.workspace.organizationId ?? null}
              membersPromise={membersPromise}
              sessionPromise={sessionPromise}
            />
          </Suspense>
        ) : null}

        <TaskDetailHeader
          taskName={task.name}
          backLabel={t("back")}
          parentLink={
            parentTask ? (
              <p className="text-muted-foreground text-sm">
                <Link
                  href={`/tasks/${parentTask.id}`}
                  className="text-primary hover:underline"
                >
                  {t("clonedFrom", { name: parentTask.name })}
                </Link>
              </p>
            ) : null
          }
          actions={
            <Suspense fallback={<TaskDetailActionsFallback />}>
              <TaskDetailActionsSlot
                taskId={taskId}
                task={task}
                forceReadOnly={forceReadOnly}
                hasAssignedSeatPromise={hasAssignedSeatPromise}
                coworkersPromise={coworkersPromise}
                agentsPromise={agentsPromise}
                membersPromise={membersPromise}
                workspaceAccessPromise={workspaceAccessPromise}
                sessionPromise={sessionPromise}
              />
            </Suspense>
          }
        />

        <Suspense fallback={null}>
          <TaskVendorGrantApprovalBannerSlot
            task={task}
            forceReadOnly={forceReadOnly}
            membersPromise={membersPromise}
            sessionPromise={sessionPromise}
          />
        </Suspense>

        <div className="mt-6 space-y-8">
          <Suspense
            fallback={
              <TaskOverviewFallback
                descriptionTitle={t("description")}
                propertiesTitle={t("properties")}
              />
            }
          >
            <TaskOverviewSection
              task={task}
              coworkersPromise={coworkersPromise}
              agentsPromise={agentsPromise}
            />
          </Suspense>

          <TaskRelatedTasks
            title={t("linkedTasksTitle")}
            emptyLabel={t("linkedTasksEmpty")}
            tasks={linkedTasks}
            relationLabels={{
              related: t("actions.relations.related"),
              blocks: t("actions.relations.blocks"),
              blocked_by: t("actions.relations.blockedBy"),
              parent: t("actions.relations.subtask"),
              child: t("actions.relations.parent"),
              duplicate: t("actions.relations.duplicate"),
              schedule_run: t("actions.relations.scheduleRun"),
              schedule_series: t("actions.relations.scheduleSeries"),
            }}
          />

          <TaskFiles title={t("files")} files={task.files ?? []} />

          {task.jobs.length > 0 && (
            <>
              <Suspense
                fallback={<TaskSectionFallback title={t("jobs")} rows={3} />}
              >
                <TaskJobsSection
                  task={task}
                  agentsPromise={agentsPromise}
                  sessionPromise={sessionPromise}
                  localePromise={localePromise}
                />
              </Suspense>
            </>
          )}
          <Suspense
            fallback={<TaskSectionFallback title={t("activity")} rows={4} />}
          >
            <TaskActivitySectionContent
              taskId={taskId}
              task={task}
              forceReadOnly={forceReadOnly}
              hasAssignedSeatPromise={hasAssignedSeatPromise}
              agentsPromise={agentsPromise}
              sessionPromise={sessionPromise}
              currentPlanPromise={currentPlanPromise}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function TaskDetailRealtimeListener({
  taskId,
  sessionPromise,
}: {
  taskId: string;
  sessionPromise: Promise<SessionResult>;
}) {
  const session = await sessionPromise;

  if (!session?.user.id) {
    return null;
  }

  return (
    <TaskStatusRealtimeListener userId={session.user.id} taskId={taskId} />
  );
}

async function TaskDetailAutoSwitch({
  targetOrganizationId,
  membersPromise,
  sessionPromise,
}: {
  targetOrganizationId: string | null;
  membersPromise: Promise<MembersResult>;
  sessionPromise: Promise<SessionResult>;
}) {
  const [members, session, t, tOrganizationSwitcher] = await Promise.all([
    membersPromise,
    sessionPromise,
    getTranslations("App.Tasks.Detail"),
    getTranslations("Components.OrganizationSwitcher"),
  ]);
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const targetAccountName = resolveAccountName(
    targetOrganizationId,
    members,
    tOrganizationSwitcher("personalAccount"),
  );

  return (
    <AutoContextSwitch
      activeOrganizationId={activeOrganizationId}
      targetOrganizationId={targetOrganizationId}
      successMessage={t("switchedWorkspace", {
        account: targetAccountName,
      })}
    />
  );
}

async function TaskVendorGrantApprovalBannerSlot({
  task,
  forceReadOnly,
  membersPromise,
  sessionPromise,
}: {
  task: Task;
  forceReadOnly: boolean;
  membersPromise: Promise<MembersResult>;
  sessionPromise: Promise<SessionResult>;
}) {
  if (forceReadOnly || task.status !== "GRANT_PENDING") {
    return null;
  }

  const grantId = task.pendingVendorGrantId;
  if (!grantId) {
    return null;
  }

  const [members, session] = await Promise.all([
    membersPromise,
    sessionPromise,
  ]);
  const orgId = task.workspace.organizationId ?? null;
  const viewerMembership = resolveViewerOrganizationMembership(orgId, members);
  if (!session?.user.id) {
    return null;
  }

  const canApprove = canApproveVendorGrants({
    organizationId: orgId,
    isAuthenticated: true,
    viewerMembership,
    taskOwnerId: task.ownerId,
    sessionUserId: session.user.id,
  });

  if (!canApprove) {
    return (
      <TaskVendorGrantPendingInfoBanner
        coworkerName={coworkerNameFromCoreAssignee(task.assignee)}
      />
    );
  }

  const reviewHref = buildVendorGrantReviewHref({
    organizationId: orgId,
    organizationSlug: viewerMembership?.organization.slug,
  });

  if (!reviewHref) {
    return null;
  }

  return (
    <TaskVendorGrantApprovalBanner
      grantId={grantId}
      coworkerName={coworkerNameFromCoreAssignee(task.assignee)}
      organizationId={orgId}
      reviewHref={reviewHref}
    />
  );
}

async function TaskOverviewSection({
  task,
  coworkersPromise,
  agentsPromise,
}: {
  task: Task;
  coworkersPromise: Promise<CoworkersResult>;
  agentsPromise: Promise<AgentsResult>;
}) {
  const projectPromise = task.projectId
    ? projectService.getProjectById(task.projectId).catch(() => null)
    : Promise.resolve(null);
  const [coworkers, agents, project, t, tStatus, locale] = await Promise.all([
    coworkersPromise,
    agentsPromise,
    projectPromise,
    getTranslations("App.Tasks.Detail"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getLocale(),
  ]);
  const { task: taskWithCoworker, agentNameById } = buildTaskDetailContext(
    task,
    coworkers,
    agents,
  );

  return (
    <>
      <TaskDescription
        title={t("description")}
        description={taskWithCoworker.description}
        agentNameById={agentNameById}
        expandLabel={t("expand")}
        collapseLabel={t("collapse")}
      />

      <TaskMetadata
        task={{
          status: task.status,
          owner: task.owner,
          organization: task.organization,
          assignee: task.assignee,
          creator: task.creator,
          credits: task.credits,
          metadata: task.metadata,
          nextRunAt: task.nextRunAt,
        }}
        project={project ? { id: project.id, name: project.name } : null}
        createdAtLabel={formatShortDateTime(task.createdAt, locale)}
        updatedAtLabel={formatShortDateTime(task.updatedAt, locale)}
        labels={{
          propertiesTitle: t("properties"),
          status: t("status"),
          statusLabels: buildTaskStatusLabels((key) => tStatus(key)),
          owner: t("owner"),
          creator: t("creator"),
          organization: t("organization"),
          personalWorkspace: t("personalWorkspace"),
          project: t("project"),
          assignee: t("assignee"),
          credits: t("credits"),
          created: t("created"),
          updated: t("updated"),
          schedule: t("schedule"),
          formatOrchestratorRole: (values) =>
            t("actorOrchestratorRole", values),
        }}
      />
    </>
  );
}

async function TaskDetailActionsSlot({
  taskId,
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  coworkersPromise,
  agentsPromise,
  membersPromise,
  workspaceAccessPromise,
  sessionPromise,
}: {
  taskId: string;
  task: Task;
  forceReadOnly: boolean;
  hasAssignedSeatPromise: Promise<boolean>;
  coworkersPromise: Promise<CoworkersResult>;
  agentsPromise: Promise<AgentsResult>;
  membersPromise: Promise<MembersResult>;
  workspaceAccessPromise: Promise<
    Awaited<ReturnType<typeof userService.getWorkspaceAccess>>
  >;
  sessionPromise: Promise<SessionResult>;
}) {
  const [
    coworkers,
    agents,
    members,
    workspaceAccess,
    session,
    hasAssignedSeat,
    t,
    tMembersTableHeader,
    memberOptions,
  ] = await Promise.all([
    coworkersPromise,
    agentsPromise,
    membersPromise,
    workspaceAccessPromise,
    sessionPromise,
    hasAssignedSeatPromise,
    getTranslations("App.Tasks.Detail"),
    getTranslations("Components.MembersTable.Header"),
    listTaskAssigneeMemberOptions(),
  ]);
  const initialDesignMdAttachment = session?.user.id
    ? await designMdService.resolveEffectiveDesignMd()
    : null;
  const {
    task: taskWithCoworker,
    agentNameById,
    coworkerOptions,
  } = buildTaskDetailContext(task, coworkers, agents);
  const isReadOnlyWorkspaceView = isReadOnlyForViewer({
    taskWorkspaceOrganizationId: task.workspace.organizationId ?? null,
    taskOwnerId: task.ownerId,
    sessionUserId: session?.user.id,
    forceReadOnly,
    taskStatus: task.status,
    hasAssignedSeat,
  });
  const canCancelTask = canCancelTaskForViewer({
    taskWorkspaceOrganizationId: task.workspace.organizationId ?? null,
    taskOwnerId: task.ownerId,
    sessionUserId: session?.user.id,
    forceReadOnly,
    taskStatus: task.status,
  });
  const orgId = task.workspace.organizationId ?? null;
  const viewerMembership =
    orgId === null
      ? undefined
      : members.find((member) => member.organizationId === orgId);
  const isOrgOwnerOrAdmin =
    viewerMembership?.role === "owner" || viewerMembership?.role === "admin";
  const personalWorkspaceMoveLabel =
    session?.user?.name?.trim() ||
    session?.user?.email?.trim() ||
    t("actions.personalWorkspace");

  return (
    <TaskDetailActions
      share={taskWithCoworker.share ?? null}
      taskId={taskId}
      status={taskWithCoworker.status}
      jobsCount={taskWithCoworker.jobsCount}
      taskLinks={task.links}
      coworkerOptions={coworkerOptions}
      memberOptions={memberOptions}
      agentNameById={agentNameById}
      defaultAssigneeId={task.assigneeId}
      defaultAssigneeUserId={task.assigneeUserId}
      initialDesignMdAttachment={initialDesignMdAttachment}
      currentOrganizationId={task.workspace.organizationId ?? null}
      organizations={members}
      hasPersonalWorkspace={workspaceAccess?.hasPersonalWorkspace ?? false}
      personalWorkspaceLabel={personalWorkspaceMoveLabel}
      isReadOnly={isReadOnlyWorkspaceView}
      canCancel={canCancelTask}
      forceReadOnly={forceReadOnly}
      isTaskOwner={session?.user.id === task.ownerId}
      isOrgOwnerOrAdmin={isOrgOwnerOrAdmin}
      hasActiveSchedule={hasActiveTaskSchedule(task.metadata, task.nextRunAt)}
      actionsMenuLabel={tMembersTableHeader("actions")}
      labels={{
        edit: t("actions.edit"),
        archive: t("actions.archive"),
        confirmArchive: t("actions.confirmArchive"),
        confirmArchiveDescription: t("actions.confirmArchiveDescription"),
        archiveError: t("actions.archiveError"),
        markAsReady: t("actions.markAsReady"),
        reopenToReady: t("actions.reopenToReady"),
        reopenToReadyTitle: t("actions.reopenToReadyTitle"),
        reopenToReadyDescription: t("actions.reopenToReadyDescription"),
        reopenToReadyCommentLabel: t("actions.reopenToReadyCommentLabel"),
        reopenToReadyCommentPlaceholder: t(
          "actions.reopenToReadyCommentPlaceholder",
        ),
        reopenToReadyCommentRequired: t("actions.reopenToReadyCommentRequired"),
        reopenToReadyConfirm: t("actions.reopenToReadyConfirm"),
        revertToDraft: t("actions.revertToDraft"),
        revertToReady: t("actions.revertToReady"),
        start: t("actions.start"),
        complete: t("actions.complete"),
        waitForExternal: t("actions.waitForExternal"),
        cancel: t("actions.cancel"),
        share: t("actions.share"),
      }}
    />
  );
}

async function TaskJobsSection({
  task,
  agentsPromise,
  sessionPromise,
  localePromise,
}: {
  task: Task;
  agentsPromise: Promise<AgentsResult>;
  sessionPromise: Promise<SessionResult>;
  localePromise: Promise<string>;
}) {
  const [agents, session, locale, t] = await Promise.all([
    agentsPromise,
    sessionPromise,
    localePromise,
    getTranslations("App.Tasks.Detail"),
  ]);

  return (
    <TaskJobs
      title={t("jobs")}
      agents={agents}
      jobs={task.jobs}
      userId={session?.user.id ?? null}
      locale={locale}
      emptyLabel={t("jobsEmpty")}
      untitledLabel={t("jobsUntitled")}
      unknownAgentLabel={t("jobsUnknownAgent")}
    />
  );
}

async function TaskActivitySectionContent({
  taskId,
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  agentsPromise,
  sessionPromise,
  currentPlanPromise,
}: {
  taskId: string;
  task: Task;
  forceReadOnly: boolean;
  hasAssignedSeatPromise: Promise<boolean>;
  agentsPromise: Promise<AgentsResult>;
  sessionPromise: Promise<SessionResult>;
  currentPlanPromise: Promise<SubscriptionPlanName | null>;
}) {
  const [agents, session, viewerPlan, hasAssignedSeat, t] = await Promise.all([
    agentsPromise,
    sessionPromise,
    currentPlanPromise,
    hasAssignedSeatPromise,
    getTranslations("App.Tasks.Detail"),
  ]);
  const {
    userById: actorsUserById,
    coworkerById,
    orchestratorById,
  } = buildTaskActivityActors(task);
  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "User",
        image: session.user.image
          ? resolveIpfsOrHttpUrl(session.user.image)
          : null,
      }
    : null;
  const userById = currentUser
    ? {
        ...actorsUserById,
        [currentUser.id]: {
          name: currentUser.name,
          image: currentUser.image,
        },
      }
    : actorsUserById;
  const agentNameById = buildAgentNameById(agents);

  return (
    <TaskActivitySection
      taskId={taskId}
      title={t("activity")}
      placeholder={t("commentPlaceholder")}
      attachLabel={t("attach")}
      submitLabel={t("submit")}
      actorCoworkerLabel={t("actorCoworker")}
      actorUserLabel={t("actorUser")}
      actorOrchestratorLabel={t("actorOrchestrator")}
      actorSystemLabel={t("actorSystem")}
      actionCommentedLabel={t("actionCommented")}
      actionUpdatedStatusLabel={t("actionUpdatedStatus")}
      events={task.events}
      taskFiles={task.files}
      agentNameById={agentNameById}
      userById={userById}
      coworkerById={coworkerById}
      orchestratorById={orchestratorById}
      currentUser={currentUser}
      expandLabel={t("expand")}
      collapseLabel={t("collapse")}
      viewerPlan={viewerPlan}
      canComment={canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: task.workspace.organizationId ?? null,
        taskOwnerId: task.ownerId,
        sessionUserId: session?.user.id,
        forceReadOnly,
        taskStatus: task.status,
        hasAssignedSeat,
      })}
    />
  );
}

function buildTaskDetailContext(
  task: Task,
  coworkers: CoworkersResult,
  agents: AgentsResult,
) {
  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    task: mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
    agentNameById: buildAgentNameById(agents),
    coworkerOptions: getCoworkerOptions(coworkers),
  };
}

function TaskDetailActionsFallback() {
  return <div className="bg-muted h-9 w-9 animate-pulse rounded-md" />;
}

function TaskOverviewFallback({
  descriptionTitle,
  propertiesTitle,
}: {
  descriptionTitle: string;
  propertiesTitle: string;
}) {
  return (
    <>
      <TaskSectionFallback title={descriptionTitle} rows={3} />
      <TaskSectionFallback title={propertiesTitle} rows={4} />
    </>
  );
}

function TaskSectionFallback({
  title,
  rows = 3,
}: {
  title: string;
  rows?: number;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={`${title}-${index}`}
            className="bg-muted h-4 animate-pulse rounded"
          />
        ))}
      </div>
    </section>
  );
}
