import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { userService } from "@/lib/services/user.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

import { TasksView } from "./components/tasks-view";
import { buildAgentNameById } from "./utils/agent-names";
import { getCoworkerOptions } from "./utils/coworker-options";

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage() {
  const [t, tColumns, cookieStore, session] = await Promise.all([
    getTranslations("App.Tasks"),
    getTranslations("App.Tasks.Columns"),
    cookies(),
    getSession(),
  ]);
  const defaultViewMode =
    parseTasksViewMode(cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value) ??
    "board";

  const [coworkers, tasksResult, agents, jobsPage] = await Promise.all([
    coworkerService.listCoworkers(),
    taskService.listTasks({ limit: 20 }),
    agentService.getAvailableAgentsWithCreditsPrice(),
    userService.listMyJobsForActiveContextPaginated({
      limit: 20,
      session,
    }),
  ]);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentNameById = buildAgentNameById(agents);
  const tasksById = new Map(tasksResult.tasks.map((task) => [task.id, task]));
  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
    seedTasksById: tasksById,
  });

  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(coworkers);

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="w-full px-2">
      <TasksView
        tasks={tasks}
        jobs={jobs}
        jobsNextCursor={jobsPage.nextCursor}
        agentPreviewById={agentPreviewById}
        nextCursor={tasksResult.pagination?.nextCursor ?? null}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        agentNameById={agentNameById}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        defaultViewMode={defaultViewMode}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            jobs: t("Tabs.jobs"),
          },
          columns: columnLabels,
          add: t("Actions.add"),
          addTask: t("Actions.addTask"),
          dragError: t("Errors.updateStatus"),
          display: {
            button: t("Display.button"),
            list: t("Display.list"),
            board: t("Display.board"),
          },
          listPlaceholder: t("List.placeholder"),
          jobs: {
            filterButton: t("Jobs.filterButton"),
            filterHideFailed: t("Jobs.filterHideFailed"),
            filterShowAll: t("Jobs.filterShowAll"),
            recentTitle: t("Jobs.recentTitle"),
            emptyRecent: t("Jobs.emptyRecent"),
            emptyList: t("Jobs.emptyList"),
            emptySection: t("Jobs.emptySection"),
            untitled: t("Jobs.untitled"),
            unknownAgent: t("Jobs.unknownAgent"),
            unknownCoworker: t("Jobs.unknownCoworker"),
          },
          loadMore: t("Actions.loadMore"),
          loading: t("Actions.loading"),
        }}
      />
    </div>
  );
}
