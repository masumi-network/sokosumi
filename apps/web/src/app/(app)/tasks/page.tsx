import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

import { TasksView } from "./components/tasks-view";

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

  const [coworkers, agents, tasksResult] = await Promise.all([
    coworkerService.listCoworkers(),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listTasks({ limit: 20 }),
  ]);

  const session = await getSession();

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const tasks = tasksResult.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );

  const coworkerDefaults: Record<
    string,
    { image: string; description: string }
  > = {
    soko: {
      image: "/images/kanji/sokosumi-logo-kanji-black.svg",
      description:
        "Your default AI coworker. Great for general tasks, research, and getting things done.",
    },
    hannah: {
      image: "/images/coworkers/hannah.png",
      description:
        "Creative strategist and communications expert. Ideal for content, marketing, and outreach.",
    },
  };

  const coworkerOptions: CoworkerOption[] = coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    const defaults = coworkerDefaults[slug];
    return {
      id: coworker.id,
      name: coworker.name,
      image: coworker.image || defaults?.image || "",
      description: coworker.description || defaults?.description || undefined,
    };
  });

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
          jobsPlaceholder: t("Jobs.placeholder"),
          dragError: t("Errors.updateStatus"),
          display: {
            button: t("Display.button"),
            list: t("Display.list"),
            board: t("Display.board"),
          },
          listPlaceholder: t("List.placeholder"),
          loadMore: t("Actions.loadMore"),
          loading: t("Actions.loading"),
        }}
      />
    </div>
  );
}
