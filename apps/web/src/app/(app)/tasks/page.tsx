import { getTranslations } from "next-intl/server";

import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

import { TasksView } from "./components/tasks-view";

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage() {
  const t = await getTranslations("App.Tasks");
  const tColumns = await getTranslations("App.Tasks.Columns");

  const [coworkers, agents, tasksResult] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listTasks({ limit: 20 }),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    complete: tColumns("complete"),
  };

  return (
    <div className="w-full space-y-6 px-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-light md:text-3xl">{t("Page.title")}</h1>
        <p className="text-muted-foreground">{t("Page.description")}</p>
      </div>

      <TasksView
        tasks={tasks}
        nextCursor={tasksResult.pagination?.nextCursor ?? null}
        columns={KANBAN_COLUMNS}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            jobs: t("Tabs.jobs"),
          },
          columns: columnLabels,
          add: t("Actions.add"),
          addTask: t("Actions.addTask"),
          jobsPlaceholder: t("Jobs.placeholder"),
          dragError: t("Errors.updateStatus"),
          display: {
            button: t("Display.button"),
            list: t("Display.list"),
            board: t("Display.board"),
          },
          listPlaceholder: t("List.placeholder"),
          loadMore: t("Actions.loadMore"),
        }}
      />
    </div>
  );
}
