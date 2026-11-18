import type { Task } from "@sokosumi/core-client";
import {
  isTaskEditableStatus,
  removeTaskContextAttachmentLinks,
  type TaskAssigneeKind,
} from "@sokosumi/utils";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Fragment, Suspense } from "react";
import { TaskContextSection } from "@/app/tasks/components/task-context-section";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import { TaskActivitySectionContent } from "@/app/tasks/components/task-detail-activity-section";
import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskMetadataSection } from "@/app/tasks/components/task-detail-metadata-section";
import { TaskParentLine } from "@/app/tasks/components/task-detail-optimistic-links";
import { TaskFiles } from "@/app/tasks/components/task-files";
import { TaskJobs } from "@/app/tasks/components/task-jobs";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";
import { TaskSubtaskSection } from "@/app/tasks/components/task-subtask-section";
import { TaskVendorGrantApprovalBanner } from "@/app/tasks/components/task-vendor-grant-approval-banner";
import { TaskVendorGrantPendingInfoBanner } from "@/app/tasks/components/task-vendor-grant-pending-info-banner";
import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_MAIN_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { taskFormAssigneeId } from "@/app/tasks/utils/coworker-options";
import { startPrivateTaskDetailReads } from "@/app/tasks/utils/private-task-detail-cache";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import { taskLinkHref } from "@/app/tasks/utils/task-href";
import {
  canCancelTaskForViewer,
  isReadOnlyForViewer,
} from "@/app/tasks/utils/task-read-only";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { userService } from "@/lib/services/user.service";
import {
  buildWorkspaceApprovalReviewHref,
  canApproveWorkspaceAccess,
  resolveViewerOrganizationMembership,
  VENDOR_GRANT_REVIEW_HASH,
} from "@/lib/utils/workspace-approval";

type PrivateReads = ReturnType<typeof startPrivateTaskDetailReads>;
export type SessionResult = Awaited<PrivateReads["sessionPromise"]>;
export type AgentsResult = Awaited<
  ReturnType<typeof agentService.getAvailableAgentsWithCreditsPrice>
>;
type CoworkersResult = Awaited<
  ReturnType<typeof coworkerService.listCoworkers>
>;
type MembersResult = Awaited<
  ReturnType<typeof userService.getMyMembersWithOrganizations>
>;
export type ProjectResult = Awaited<PrivateReads["projectPromise"]>;

interface TaskDetailViewProps {
  task: Task;
  /**
   * Forces the view into read-only mode regardless of ownership. Used by the
   * admin task detail page, where the viewer is never the owner and must not be
   * able to edit, comment, or mutate the task.
   */
  forceReadOnly?: boolean;
  relatedTaskHrefBasePath?: string;
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
  relatedTaskHrefBasePath,
}: TaskDetailViewProps) {
  const taskId = task.id;
  const coworkersPromise = coworkerService.listCoworkers().catch(() => []);
  const assigneeOptionsPromise = forceReadOnly
    ? Promise.resolve([])
    : listTaskAssigneeOptions(task.workspace.organizationId ?? null);
  // Started with the other reads so the Project picker adds no waterfall.
  const projectOptionsPromise =
    forceReadOnly || !isTaskEditableStatus(task.status)
      ? Promise.resolve([])
      : getProjectFilterOptions().catch((error: unknown) => {
          unstable_rethrow(error);
          return null;
        });
  const agentsPromise = agentService.getAvailableAgentsWithCreditsPrice();
  const membersPromise = userService.getMyMembersWithOrganizations();
  const workspaceAccessPromise = userService.getWorkspaceAccess();
  const {
    sessionPromise,
    currentPlanPromise,
    hasAssignedSeatPromise,
    mentionableUsersPromise,
    projectPromise,
    viewerSokoBotPromise,
  } = startPrivateTaskDetailReads(task, forceReadOnly);
  const translationsPromise = getTranslations("App.Tasks.Detail");
  const linkedTasks = mapVisibleTaskLinks(task.links);
  const parentTask = linkedTasks.find((link) => link.relation === "child");

  const [t, tStatus] = await Promise.all([
    translationsPromise,
    getTranslations("App.Tasks.Filters.statusOptions"),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className={TASK_DETAIL_SHELL_CLASS}>
        <Suspense fallback={null}>
          <TaskDetailRealtimeListener
            taskId={taskId}
            sessionPromise={sessionPromise}
          />
        </Suspense>
        <div className={TASK_DETAIL_GRID_CLASS}>
          <div className={TASK_DETAIL_MAIN_CLASS}>
            <TaskDetailHeader
              taskName={task.name}
              identifier={task.identifier}
              identifierLabels={
                task.identifier
                  ? {
                      copy: t("copyIdentifier"),
                      copied: t("identifierCopied", {
                        identifier: task.identifier,
                      }),
                      copyError: t("identifierCopyError"),
                    }
                  : undefined
              }
              backLabel={t("back")}
              // Admin and developer views have their own list; the reader's
              // own board is not the likely next page there.
              loadBoardOnMount={!forceReadOnly}
              calendarBackLabel={t("backToCalendar")}
              parentLink={
                <>
                  {task.ancestors?.length ? (
                    <nav
                      aria-label={t("subtaskOf")}
                      className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm"
                    >
                      <span>{t("subtaskOf")}</span>
                      {task.ancestors.map((ancestor, index) => (
                        <Fragment key={ancestor.id}>
                          {index > 0 ? <span aria-hidden>/</span> : null}
                          <Link
                            href={taskLinkHref(
                              ancestor,
                              relatedTaskHrefBasePath,
                            )}
                            className="text-foreground underline underline-offset-4"
                          >
                            {ancestor.name}
                          </Link>
                        </Fragment>
                      ))}
                    </nav>
                  ) : null}
                  {parentTask ? (
                    <TaskParentLine
                      parent={parentTask}
                      href={taskLinkHref(parentTask, relatedTaskHrefBasePath)}
                    >
                      {t("clonedFrom", { name: parentTask.name })}
                    </TaskParentLine>
                  ) : null}
                </>
              }
              actions={
                <Suspense fallback={<TaskDetailActionsFallback />}>
                  <TaskDetailActionsSlot
                    taskId={taskId}
                    task={task}
                    forceReadOnly={forceReadOnly}
                    hasAssignedSeatPromise={hasAssignedSeatPromise}
                    coworkersPromise={coworkersPromise}
                    assigneeOptionsPromise={assigneeOptionsPromise}
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

            <Suspense
              fallback={
                <TaskSectionFallback title={t("description")} rows={3} />
              }
            >
              <TaskDescriptionSection
                task={task}
                agentsPromise={agentsPromise}
              />
            </Suspense>

            <Suspense
              fallback={<TaskSectionFallback title={t("context")} rows={1} />}
            >
              <TaskContextSectionSlot
                projectPromise={projectPromise}
                task={task}
              />
            </Suspense>

            {forceReadOnly ? null : (
              <Suspense
                fallback={
                  <TaskSectionFallback title={t("subtasks")} rows={2} />
                }
              >
                <TaskSubtaskSection
                  task={task}
                  hasAssignedSeatPromise={hasAssignedSeatPromise}
                />
              </Suspense>
            )}
          </div>

          <aside className={TASK_DETAIL_SIDEBAR_CLASS}>
            <div className="space-y-6">
              <Suspense
                fallback={
                  <TaskSectionFallback title={t("properties")} rows={4} />
                }
              >
                <TaskMetadataSection
                  task={task}
                  forceReadOnly={forceReadOnly}
                  hasAssignedSeatPromise={hasAssignedSeatPromise}
                  projectPromise={projectPromise}
                  sessionPromise={sessionPromise}
                  assigneeOptionsPromise={assigneeOptionsPromise}
                  projectOptionsPromise={projectOptionsPromise}
                />
              </Suspense>
              <TaskRelatedTasks
                tasks={linkedTasks}
                relationLabels={{
                  related: t("actions.relations.related"),
                  blocks: t("actions.relations.blocks"),
                  blocked_by: t("actions.relations.blockedBy"),
                  parent: t("actions.relations.childTask"),
                  child: t("actions.relations.parent"),
                  duplicate: t("actions.relations.duplicate"),
                }}
                statusLabels={buildTaskStatusLabels((key) => tStatus(key))}
                hrefBasePath={relatedTaskHrefBasePath}
              />
            </div>
          </aside>

          <div className={TASK_DETAIL_MAIN_CLASS}>
            <TaskFiles
              taskId={task.id}
              title={t("files")}
              files={task.files ?? []}
              expandLabel={t("expand")}
              collapseLabel={t("collapse")}
              downloadAllName={task.name}
            />

            {task.jobs.length > 0 && (
              <Suspense
                fallback={<TaskSectionFallback title={t("jobs")} rows={3} />}
              >
                <TaskJobsSection
                  task={task}
                  agentsPromise={agentsPromise}
                  sessionPromise={sessionPromise}
                />
              </Suspense>
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
                mentionableUsersPromise={mentionableUsersPromise}
                viewerSokoBotPromise={viewerSokoBotPromise}
              />
            </Suspense>
          </div>
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

function taskAssigneeDisplayName(
  assignee: Task["assignee"],
  personalAssistantFallback: string,
): string | null {
  if (!assignee) {
    return null;
  }
  if (assignee.type === "sokoBot") {
    return assignee.sokoBot.name?.trim() || personalAssistantFallback;
  }
  if (assignee.type === "user") {
    return assignee.user.name ?? null;
  }
  return assignee.coworker.name ?? null;
}

function taskAssigneeKindFromTask(
  assignee: Task["assignee"],
): TaskAssigneeKind {
  if (!assignee) return "unset";
  return assignee.type === "user" ? "human" : assignee.type;
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
  const tTasks = await getTranslations("App.Tasks");
  const personalAssistantFallback = tTasks("personalAssistant");
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

  const canApprove = canApproveWorkspaceAccess({
    organizationId: orgId,
    isAuthenticated: true,
    viewerMembership,
    taskOwnerId: task.ownerId,
    sessionUserId: session.user.id,
  });

  if (!canApprove) {
    return (
      <TaskVendorGrantPendingInfoBanner
        coworkerName={taskAssigneeDisplayName(
          task.assignee,
          personalAssistantFallback,
        )}
      />
    );
  }

  const reviewHref = buildWorkspaceApprovalReviewHref({
    organizationId: orgId,
    organizationSlug: viewerMembership?.organization.slug,
    hash: VENDOR_GRANT_REVIEW_HASH,
  });

  return (
    <TaskVendorGrantApprovalBanner
      grantId={grantId}
      coworkerName={taskAssigneeDisplayName(
        task.assignee,
        personalAssistantFallback,
      )}
      organizationId={orgId}
      reviewHref={reviewHref}
    />
  );
}

async function TaskDescriptionSection({
  task,
  agentsPromise,
}: {
  task: Task;
  agentsPromise: Promise<AgentsResult>;
}) {
  const [agents, t] = await Promise.all([
    agentsPromise,
    getTranslations("App.Tasks.Detail"),
  ]);
  const descriptionBody = task.description
    ? removeTaskContextAttachmentLinks(task.description)
    : null;

  return (
    <TaskDescription
      title={t("description")}
      description={descriptionBody}
      agentNameById={buildAgentNameById(agents)}
      expandLabel={t("expand")}
      collapseLabel={t("collapse")}
    />
  );
}

async function TaskContextSectionSlot({
  task,
  projectPromise,
}: {
  task: Task;
  projectPromise: Promise<ProjectResult>;
}) {
  const project = await projectPromise;

  return (
    <TaskContextSection
      description={task.description}
      project={
        project
          ? {
              id: project.id,
              name: project.name,
              logo: project.logo,
              designMd: project.designMd,
              briefingUrl: project.briefingUrl,
              contextMd: project.contextMd,
            }
          : null
      }
    />
  );
}

async function TaskDetailActionsSlot({
  taskId,
  task,
  forceReadOnly,
  hasAssignedSeatPromise,
  coworkersPromise,
  assigneeOptionsPromise,
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
  assigneeOptionsPromise: ReturnType<typeof listTaskAssigneeOptions>;
  agentsPromise: Promise<AgentsResult>;
  membersPromise: Promise<MembersResult>;
  workspaceAccessPromise: Promise<
    Awaited<ReturnType<typeof userService.getWorkspaceAccess>>
  >;
  sessionPromise: Promise<SessionResult>;
}) {
  const [
    coworkers,
    coworkerOptions,
    agents,
    members,
    workspaceAccess,
    session,
    hasAssignedSeat,
    t,
    tTasks,
    tMembersTableHeader,
    initialDesignMdAttachment,
  ] = await Promise.all([
    coworkersPromise,
    assigneeOptionsPromise,
    agentsPromise,
    membersPromise,
    workspaceAccessPromise,
    sessionPromise,
    hasAssignedSeatPromise,
    getTranslations("App.Tasks.Detail"),
    getTranslations("App.Tasks"),
    getTranslations("Components.MembersTable.Header"),
    sessionPromise.then((session) =>
      session?.user.id ? designMdService.resolveEffectiveDesignMd() : null,
    ),
  ]);
  const { task: taskWithCoworker, agentNameById } = buildTaskDetailContext(
    task,
    coworkers,
    agents,
    tTasks("personalAssistant"),
  );
  const isReadOnlyWorkspaceView = isReadOnlyForViewer({
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
  const personalWorkspaceMoveLabel =
    session?.user?.name?.trim() ||
    session?.user?.email?.trim() ||
    t("actions.personalWorkspace");

  return (
    <TaskDetailActions
      share={taskWithCoworker.share ?? null}
      taskId={taskId}
      status={taskWithCoworker.status}
      taskVisibility={taskWithCoworker.visibility}
      jobsCount={taskWithCoworker.jobsCount}
      taskLinks={task.links}
      coworkerOptions={coworkerOptions}
      agentNameById={agentNameById}
      defaultAssigneeId={taskFormAssigneeId(task) || undefined}
      assigneeKind={taskAssigneeKindFromTask(task.assignee)}
      assigneeName={taskAssigneeDisplayName(
        task.assignee,
        tTasks("personalAssistant"),
      )}
      initialDesignMdAttachment={initialDesignMdAttachment}
      currentOrganizationId={task.workspace.organizationId ?? null}
      organizations={members}
      hasPersonalWorkspace={workspaceAccess?.hasPersonalWorkspace ?? false}
      personalWorkspaceLabel={personalWorkspaceMoveLabel}
      isReadOnly={isReadOnlyWorkspaceView}
      canCancel={canCancelTask}
      forceReadOnly={forceReadOnly}
      isTaskOwner={session?.user.id === task.ownerId}
      taskOwnerId={task.ownerId}
      hasAssignedSeat={hasAssignedSeat}
      taskBlueprint={
        !forceReadOnly && hasAssignedSeat
          ? {
              name: task.name,
              tags: task.tags,
              workspaceTags: task.workspaceTags,
              description: task.description
                ? removeTaskContextAttachmentLinks(task.description)
                : null,
              projectId: task.projectId,
              visibility: task.visibility,
              assigneeId: task.assigneeId,
              assigneeSokoBotId: task.assigneeSokoBotId,
              assigneeUserId: task.assigneeUserId,
            }
          : undefined
      }
      sendToChat={
        !forceReadOnly &&
        hasAssignedSeat &&
        task.visibility !== "PRIVATE" &&
        session?.user.id
          ? { currentUserId: session.user.id }
          : undefined
      }
      actionsMenuLabel={tMembersTableHeader("actions")}
      labels={{
        edit: t("actions.edit"),
        archive: t("actions.archive"),
        archiveError: t("actions.archiveError"),
        reopenToReady: t("actions.reopenToReady"),
        reopenToReadyCommentRequired: t("actions.reopenToReadyCommentRequired"),
        cancel: t("actions.cancel"),
        share: t("actions.share"),
        startWorking: t("actions.startWorking"),
        pauseToReady: t("actions.pauseToReady"),
        waitExternal: t("actions.waitExternal"),
        resumeRunning: t("actions.resumeRunning"),
        resumeReady: t("actions.resumeReady"),
        markComplete: t("actions.markComplete"),
      }}
    />
  );
}

async function TaskJobsSection({
  task,
  agentsPromise,
  sessionPromise,
}: {
  task: Task;
  agentsPromise: Promise<AgentsResult>;
  sessionPromise: Promise<SessionResult>;
}) {
  const [agents, session, t] = await Promise.all([
    agentsPromise,
    sessionPromise,
    getTranslations("App.Tasks.Detail"),
  ]);

  return (
    <TaskJobs
      title={t("jobs")}
      agents={agents}
      jobs={task.jobs}
      userId={session?.user.id ?? null}
      emptyLabel={t("jobsEmpty")}
      untitledLabel={t("jobsUntitled")}
      unknownAgentLabel={t("jobsUnknownAgent")}
    />
  );
}

function buildTaskDetailContext(
  task: Task,
  coworkers: CoworkersResult,
  agents: AgentsResult,
  personalAssistantFallback: string,
) {
  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    task: mapTaskToTaskWithCoworker(
      task,
      coworkersById,
      agentsById,
      personalAssistantFallback,
    ),
    agentNameById: buildAgentNameById(agents),
  };
}

function TaskDetailActionsFallback() {
  return <div className="bg-muted size-9 animate-pulse rounded-md" />;
}

function TaskSectionFallback({
  title,
  rows = 3,
}: {
  title: string | null;
  rows?: number;
}) {
  return (
    <section className="space-y-4">
      {title ? (
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      ) : null}
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={`${title ?? "section"}-${index}`}
            className="bg-muted h-4 animate-pulse rounded"
          />
        ))}
      </div>
    </section>
  );
}
