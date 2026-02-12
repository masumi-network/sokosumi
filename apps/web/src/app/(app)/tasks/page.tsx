import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { getSession } from "@/lib/auth/utils";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
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
import { getCoworkerOptions } from "./utils/coworker-options";

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage() {
  const t = await getTranslations("App.Tasks");
  const tColumns = await getTranslations("App.Tasks.Columns");
  const cookieStore = await cookies();
  const defaultViewMode =
    parseTasksViewMode(cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value) ??
    "board";

  const [coworkers, agents, tasksResult, jobsPage] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listTasks({ limit: 20 }),
    userService.listMyJobsForActiveContextPaginated({ limit: 20 }),
  ]);

  const session = await getSession();

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const tasksById = new Map(tasksResult.tasks.map((task) => [task.id, task]));
  const missingTaskIds = Array.from(
    new Set(
      jobsPage.jobs
        .map((job) => job.taskId)
        .filter((taskId): taskId is string => {
          if (!taskId) return false;
          return !tasksById.has(taskId);
        }),
    ),
  );
  if (missingTaskIds.length > 0) {
    const missingTasks = await Promise.all(
      missingTaskIds.map((taskId) => taskService.getTaskById(taskId)),
    );
    for (const task of missingTasks) {
      if (!task) continue;
      tasksById.set(task.id, task);
    }
  }
  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );
  const jobs = jobsPage.jobs.map((job) => ({
    id: job.id,
    agentId: job.agentId,
    name: job.name,
    createdAt: new Date(job.createdAt).toISOString(),
    completedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : null,
    status: job.status,
    jobType: job.jobType,
    coworker: (() => {
      const task = job.taskId ? tasksById.get(job.taskId) : null;
      if (!task) {
        return {
          name: job.user.name ?? null,
          image: job.user.image ?? null,
        };
      }
      const coworker = task?.coworkerId
        ? (coworkersById.get(task.coworkerId) ?? null)
        : null;
      return {
        name: coworker?.name ?? null,
        image: getCoworkerImage(coworker),
      };
    })(),
  }));
  const agentPreviewById: Record<
    string,
    { name: string; icon: string | null }
  > = {};
  for (const job of jobsPage.jobs) {
    if (agentPreviewById[job.agentId]) continue;
    agentPreviewById[job.agentId] = {
      name: getAgentName(job.agent),
      icon: getAgentResolvedIcon(job.agent),
    };
  }

  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(coworkers);

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    complete: tColumns("complete"),
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
        userId={session?.user.id ?? null}
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
