import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { AutoContextSwitch } from "@/app/components/auto-context-switch";
import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";
import { TaskJobs } from "@/app/tasks/components/task-jobs";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskStatusRealtimeListener } from "@/app/tasks/components/task-status-realtime-listener";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import {
  type ActiveSubscription,
  resolveCurrentPlanName,
} from "@/components/billing/subscription-plan-utils";
import { auth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import { resolveAccountName } from "@/lib/utils/account-name";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const [
    taskResult,
    coworkers,
    agents,
    members,
    session,
    locale,
    t,
    tOrganizationSwitcher,
  ] = await Promise.all([
    taskService.getTaskById(taskId, ["owned"]),
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    userService.getMyMembersWithOrganizations(),
    getSession(),
    getLocale(),
    getTranslations("App.Tasks.Detail"),
    getTranslations("Components.OrganizationSwitcher"),
  ]);

  if (!taskResult) {
    return notFound();
  }
  let activeSubscriptions: ActiveSubscription[] = [];
  try {
    const requestHeaders = await headers();
    const subscriptions = taskResult.organizationId
      ? await auth.api.listActiveSubscriptions({
          headers: requestHeaders,
          query: {
            customerType: "organization",
            referenceId: taskResult.organizationId,
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
  const currentPlan = resolveCurrentPlanName(activeSubscriptions) ?? "free";
  const isFreePlan = currentPlan === "free";

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentNameById = buildAgentNameById(agents);
  const task = mapTaskToTaskWithCoworker(taskResult, coworkersById, agentsById);
  const targetOrganizationId = taskResult.organizationId;
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const targetAccountName = resolveAccountName(
    targetOrganizationId,
    members,
    tOrganizationSwitcher("personalAccount"),
  );
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
    <div className="min-h-full w-full md:pr-60">
      {/* Centered content */}
      <div className="mx-auto max-w-4xl px-4">
        <AutoContextSwitch
          activeOrganizationId={activeOrganizationId}
          targetOrganizationId={targetOrganizationId}
          successMessage={t("switchedWorkspace", {
            account: targetAccountName,
          })}
        />
        {session?.user.id ? (
          <TaskStatusRealtimeListener
            userId={session.user.id}
            taskId={taskId}
          />
        ) : null}
        <TaskDetailHeader
          task={task}
          labels={{
            back: t("back"),
            actions: {
              edit: t("actions.edit"),
              delete: t("actions.delete"),
              confirmDelete: t("actions.confirmDelete"),
              confirmDeleteDescription: t("actions.confirmDeleteDescription"),
              deleteError: t("actions.deleteError"),
              markAsReady: t("actions.markAsReady"),
              revertToDraft: t("actions.revertToDraft"),
              cancelRequest: t("actions.cancelRequest"),
            },
          }}
        />

        <div className="mt-6 space-y-8">
          <TaskDescription
            title={t("description")}
            description={task.description}
            agentNameById={agentNameById}
            expandLabel={t("expand")}
            collapseLabel={t("collapse")}
          />

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
            events={task.events}
            agentNameById={agentNameById}
            userById={userById}
            coworkerById={coworkerById}
            currentUser={currentUser}
            expandLabel={t("expand")}
            collapseLabel={t("collapse")}
            isFreePlan={isFreePlan}
          />
        </div>

        {/* Mobile properties */}
        <div className="mt-6 md:hidden">
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
        </div>
      </div>

      {/* Properties sidebar - fixed on right edge as a panel */}
      <aside className="border-border bg-background fixed top-16 right-0 bottom-0 hidden w-60 overflow-y-auto border-l md:block">
        <div className="px-6 py-5">
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
        </div>
      </aside>
    </div>
  );
}
