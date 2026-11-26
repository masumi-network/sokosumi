import { TaskStatus } from "@sokosumi/core-client";
import type { useTranslations } from "next-intl";
import type { KanbanColumnId } from "@/app/tasks/types/task-board";

type TasksTranslator = ReturnType<typeof useTranslations<"App.Tasks">>;

/** The board column titles. The status picker also searches by them. */
export function buildTaskColumnLabels(
  t: TasksTranslator,
): Record<KanbanColumnId, string> {
  return {
    backlog: t("Columns.backlog"),
    todo: t("Columns.todo"),
    "in-progress": t("Columns.inProgress"),
    "input-required": t("Columns.inputRequired"),
    done: t("Columns.done"),
  };
}

/**
 * The toolbar and column names, from the `App.Tasks` messages. The page and
 * its loading shell both build them here, so the shell draws the same words
 * and wraps where the board does.
 */
export function buildTasksViewLabels(t: TasksTranslator) {
  const columns = buildTaskColumnLabels(t);
  return {
    filters: {
      title: t("Filters.title"),
      searchPlaceholder: t("Filters.searchPlaceholder"),
      emptyResults: t("Filters.emptyResults"),
      all: t("Filters.all"),
      scopeLabel: t("Filters.scopeLabel"),
      scopeOwned: t("Filters.scopeOwned"),
      assignedToMe: t("Filters.assignedToMe"),
      scopeWorkspace: t("Filters.scopeWorkspace"),
      coworkerLabel: t("Filters.coworkerLabel"),
      statusLabel: t("Filters.statusLabel"),
      visibilityLabel: t("Filters.visibilityLabel"),
      visibilityPrivate: t("Filters.visibilityPrivate"),
      statusOptions: Object.fromEntries(
        Object.values(TaskStatus).map((status) => [
          status,
          t(`Filters.statusOptions.${status}`),
        ]),
      ) as Record<TaskStatus, string>,
    },
    columns,
    display: {
      button: t("Display.button"),
      layout: t("Display.layout"),
      list: t("Display.list"),
      board: t("Display.board"),
      density: t("Display.density"),
      normal: t("Display.normal"),
      compact: t("Display.compact"),
      sortBy: t("Display.sortBy"),
      sortOptions: {
        updatedAt: t("Display.sortOptions.updatedAt"),
        createdAt: t("Display.sortOptions.createdAt"),
        priority: t("Display.sortOptions.priority"),
        dueOn: t("Display.sortOptions.dueOn"),
      },
      showSubtasks: t("Display.showSubtasks"),
    },
  };
}
