import { getTranslations } from "next-intl/server";

import { TasksView } from "./components/tasks-view";
import { KANBAN_COLUMNS, MOCK_TASKS } from "./data/mock-data";
import type { KanbanColumnId } from "./types";

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage() {
  const t = await getTranslations("App.Tasks");
  const tColumns = await getTranslations("App.Tasks.Columns");

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    "refund-requested": tColumns("refundRequested"),
  };

  return (
    <div className="w-full space-y-6 px-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-light md:text-3xl">{t("Page.title")}</h1>
        <p className="text-muted-foreground">{t("Page.description")}</p>
      </div>

      <TasksView
        tasks={MOCK_TASKS}
        columns={KANBAN_COLUMNS}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            jobs: t("Tabs.jobs"),
          },
          columns: columnLabels,
          addTask: t("Actions.addTask"),
          taskCard: {
            budget: t("Card.budget"),
          },
          jobsPlaceholder: t("Jobs.placeholder"),
          display: {
            button: t("Display.button"),
            list: t("Display.list"),
            board: t("Display.board"),
          },
          listPlaceholder: t("List.placeholder"),
        }}
      />
    </div>
  );
}
