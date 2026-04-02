import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailActions } from "@/app/tasks/components/task-detail-actions";
import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskJobs } from "@/app/tasks/components/task-jobs";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import {
  type ActiveSubscription,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { auth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

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

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const taskResult = await taskService.getTaskById(taskId, ["owned"]);

  if (!taskResult) {
    return notFound();
  }

  const coworkersPromise = coworkerService.listCoworkers();
  const agentsPromise = agentService.getAvailableAgentsWithCreditsPrice();
  const membersPromise = userService.getMyMembersWithOrganizations();
  const sessionPromise = getSession();
  const localePromise = getLocale();
  const activeSubscriptionsPromise = getActiveSubscriptions(
    taskResult.organizationId,
  );
  const translationsPromise = getTranslations("App.Tasks.Detail");
  const linkedTasks = mapVisibleTaskLinks(taskResult.links);

  const t = await translationsPromise;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 pb-8">
        <Suspense fallback={null}>
          <TaskDetailEffects
            taskId={taskId}
            targetOrganizationId={taskResult.organizationId}
            membersPromise={membersPromise}
            sessionPromise={sessionPromise}
          />
        </Suspense>

        <TaskDetailHeader
          taskName={taskResult.name}
          backLabel={t("back")}
          actions={
            <Suspense fallback={<TaskDetailActionsFallback />}>
              <TaskDetailActionsSlot
                taskId={taskId}
                taskResult={taskResult}
                coworkersPromise={coworkersPromise}
                agentsPromise={agentsPromise}
                membersPromise={membersPromise}
                sessionPromise={sessionPromise}
              />
            </Suspense>
          }
        />

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
              taskResult={taskResult}
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
            }}
          />

          {taskResult?.jobs?.length > 0 && (
            <>
              <Suspense
                fallback={<TaskSectionFallback title={t("jobs")} rows={3} />}
              >
                <TaskJobsSection
                  taskResult={taskResult}
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
              taskResult={taskResult}
              coworkersPromise={coworkersPromise}
              agentsPromise={agentsPromise}
              sessionPromise={sessionPromise}
              activeSubscriptionsPromise={activeSubscriptionsPromise}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function TaskDetailEffects({
  taskId,
  targetOrganizationId,
  membersPromise,
  sessionPromise,
}: {
  taskId: string;
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
    <>
      <AutoContextSwitch
        activeOrganizationId={activeOrganizationId}
        targetOrganizationId={targetOrganizationId}
        successMessage={t("switchedWorkspace", {
          account: targetAccountName,
        })}
      />
      {session?.user.id ? (
        <TaskStatusRealtimeListener userId={session.user.id} taskId={taskId} />
      ) : null}
    </>
  );
}

async function TaskOverviewSection({
  taskResult,
  coworkersPromise,
  agentsPromise,
}: {
  taskResult: Task;
  coworkersPromise: Promise<CoworkersResult>;
  agentsPromise: Promise<AgentsResult>;
}) {
  const [coworkers, agents, t] = await Promise.all([
    coworkersPromise,
    agentsPromise,
    getTranslations("App.Tasks.Detail"),
  ]);
  const { task, agentNameById } = buildTaskDetailContext(
    taskResult,
    coworkers,
    agents,
  );

  return (
    <>
      <TaskDescription
        title={t("description")}
        description={task.description}
        agentNameById={agentNameById}
        expandLabel={t("expand")}
        collapseLabel={t("collapse")}
      />

      <TaskMetadata
        task={task}
        labels={{
          propertiesTitle: t("properties"),
          status: t("status"),
          coworker: t("coworker"),
          created: t("created"),
          updated: t("updated"),
        }}
      />
    </>
  );
}

async function TaskDetailActionsSlot({
  taskId,
  taskResult,
  coworkersPromise,
  agentsPromise,
  membersPromise,
  sessionPromise,
}: {
  taskId: string;
  taskResult: Task;
  coworkersPromise: Promise<CoworkersResult>;
  agentsPromise: Promise<AgentsResult>;
  membersPromise: Promise<MembersResult>;
  sessionPromise: Promise<SessionResult>;
}) {
  const [coworkers, agents, members, session, t, tMembersTableHeader] =
    await Promise.all([
      coworkersPromise,
      agentsPromise,
      membersPromise,
      sessionPromise,
      getTranslations("App.Tasks.Detail"),
      getTranslations("Components.MembersTable.Header"),
    ]);
  const { task, agentNameById, coworkerOptions } = buildTaskDetailContext(
    taskResult,
    coworkers,
    agents,
  );
  const personalWorkspaceMoveLabel =
    session?.user?.name?.trim() ||
    session?.user?.email?.trim() ||
    t("actions.personalWorkspace");

  return (
    <TaskDetailActions
      share={task.share ?? null}
      taskId={taskId}
      status={task.status}
      jobsCount={task.jobsCount}
      taskLinks={taskResult.links}
      coworkerOptions={coworkerOptions}
      agentNameById={agentNameById}
      defaultCoworkerId={taskResult.coworkerId}
      currentOrganizationId={taskResult.organizationId}
      organizations={members}
      personalWorkspaceLabel={personalWorkspaceMoveLabel}
      actionsMenuLabel={tMembersTableHeader("actions")}
      labels={{
        edit: t("actions.edit"),
        delete: t("actions.delete"),
        confirmDelete: t("actions.confirmDelete"),
        confirmDeleteDescription: t("actions.confirmDeleteDescription"),
        deleteError: t("actions.deleteError"),
        markAsReady: t("actions.markAsReady"),
        revertToDraft: t("actions.revertToDraft"),
        cancelRequest: t("actions.cancelRequest"),
        share: t("actions.share"),
      }}
    />
  );
}

async function TaskJobsSection({
  taskResult,
  agentsPromise,
  sessionPromise,
  localePromise,
}: {
  taskResult: Task;
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
      jobs={taskResult.jobs}
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
  taskResult,
  coworkersPromise,
  agentsPromise,
  sessionPromise,
  activeSubscriptionsPromise,
}: {
  taskId: string;
  taskResult: Task;
  coworkersPromise: Promise<CoworkersResult>;
  agentsPromise: Promise<AgentsResult>;
  sessionPromise: Promise<SessionResult>;
  activeSubscriptionsPromise: Promise<ActiveSubscription[]>;
}) {
  const [coworkers, agents, session, activeSubscriptions, t] =
    await Promise.all([
      coworkersPromise,
      agentsPromise,
      sessionPromise,
      activeSubscriptionsPromise,
      getTranslations("App.Tasks.Detail"),
    ]);
  const { agentNameById } = buildTaskDetailContext(
    taskResult,
    coworkers,
    agents,
  );
  const currentPlan = resolveCurrentPlanName(activeSubscriptions) ?? "free";
  const isFreePlan = currentPlan === "free";
  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "User",
        image: session.user.image ?? null,
      }
    : null;
  const userById = currentUser ? { [currentUser.id]: currentUser } : undefined;
  const coworkerById = Object.fromEntries(
    coworkers.map((coworker) => [
      coworker.id,
      {
        name: coworker.name,
        image: getCoworkerImage(coworker),
      },
    ]),
  );

  return (
    <TaskActivitySection
      taskId={taskId}
      title={t("activity")}
      placeholder={t("commentPlaceholder")}
      attachLabel={t("attach")}
      submitLabel={t("submit")}
      actorCoworkerLabel={t("actorCoworker")}
      actorUserLabel={t("actorUser")}
      actorSystemLabel={t("actorSystem")}
      actionCommentedLabel={t("actionCommented")}
      actionUpdatedStatusLabel={t("actionUpdatedStatus")}
      events={taskResult.events}
      agentNameById={agentNameById}
      userById={userById}
      coworkerById={coworkerById}
      currentUser={currentUser}
      expandLabel={t("expand")}
      collapseLabel={t("collapse")}
      isFreePlan={isFreePlan}
    />
  );
}

async function getActiveSubscriptions(organizationId: string | null) {
  let activeSubscriptions: ActiveSubscription[] = [];

  try {
    const requestHeaders = await headers();
    const subscriptions = organizationId
      ? await auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "organization",
            referenceId: organizationId,
          },
        })
      : await auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "user",
          },
        });

    activeSubscriptions = subscriptions as ActiveSubscription[];
  } catch {
    activeSubscriptions = [];
  }

  return activeSubscriptions;
}

function buildTaskDetailContext(
  taskResult: Task,
  coworkers: CoworkersResult,
  agents: AgentsResult,
) {
  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    task: mapTaskToTaskWithCoworker(taskResult, coworkersById, agentsById),
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
