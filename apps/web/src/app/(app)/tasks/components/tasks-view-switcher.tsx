"use client";

import { AtSign, Hand, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TasksFilters } from "@/app/tasks/utils/tasks-filters";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// The shared item stretches (flex-1) so two-option controls split evenly.
// Here the labels differ in length, and equal widths squeeze the longer
// ones until a label runs into the next view's icon.
const ITEM_CLASS_NAME = "flex-none";

export type TasksView = "all" | "mine" | "needs-me" | "mentions";

/**
 * The view a filter set shows. Needs me reads the reader's own Tasks and
 * Mentions reads the whole workspace, so neither combines with My tasks:
 * one view at a time, Needs me first when an old link sets both.
 */
export function getTasksView(
  filters: TasksFilters,
  userId: string | null | undefined,
): TasksView {
  if (filters.needsMe) return "needs-me";
  if (filters.mentions) return "mentions";
  if (userId && filters.assigneeUserId === userId) return "mine";
  return "all";
}

/**
 * The filter change that switches to a view. It clears the other views and
 * keeps every other filter, so a coworker or status the reader picked stays.
 */
export function getTasksViewPatch(
  view: TasksView,
  filters: TasksFilters,
  userId: string,
): Partial<TasksFilters> {
  const patch: Partial<TasksFilters> = {
    needsMe: view === "needs-me" ? true : undefined,
    mentions: view === "mentions" ? true : undefined,
  };
  if (view === "mine") {
    return {
      ...patch,
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: userId,
    };
  }
  return filters.assigneeUserId === userId
    ? { ...patch, assigneeUserId: null }
    : patch;
}

interface TasksViewSwitcherProps {
  value: TasksView;
  onChange: (view: TasksView) => void;
  /** Off when the viewer is not an assignee option, so My tasks would list nothing. */
  showMine: boolean;
  labels: { all: string; assignedToMe: string };
}

function isTasksView(value: string): value is TasksView {
  return (
    value === "all" ||
    value === "mine" ||
    value === "needs-me" ||
    value === "mentions"
  );
}

/**
 * All, My tasks, Needs me and Mentions as one single-choice control, because
 * the views do not combine. Needs me and Mentions keep their names on wide
 * screens and drop to an icon below lg, so the toolbar stays one row beside
 * an open sidebar. My tasks drops to its icon on a phone for the same row.
 */
export function TasksViewSwitcher({
  value,
  onChange,
  showMine,
  labels,
}: TasksViewSwitcherProps) {
  const t = useTranslations("App.Tasks.Filters");

  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={t("viewLabel")}
      // A pressed view stays pressed: there is always one view.
      onValueChange={(next) => {
        if (isTasksView(next)) onChange(next);
      }}
    >
      <ToggleGroupItem value="all" className={ITEM_CLASS_NAME}>
        {labels.all}
      </ToggleGroupItem>
      {showMine ? (
        <ToggleGroupItem
          value="mine"
          className={ITEM_CLASS_NAME}
          aria-label={labels.assignedToMe}
        >
          <UserRound aria-hidden />
          <span className="max-sm:sr-only">{labels.assignedToMe}</span>
        </ToggleGroupItem>
      ) : null}
      <ToggleGroupItem
        value="needs-me"
        className={ITEM_CLASS_NAME}
        aria-label={t("needsMe")}
        title={t("needsMeHint")}
      >
        <Hand aria-hidden />
        <span className="max-lg:sr-only">{t("needsMe")}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="mentions"
        className={ITEM_CLASS_NAME}
        aria-label={t("mentions")}
        title={t("mentionsHint")}
      >
        <AtSign aria-hidden />
        <span className="max-lg:sr-only">{t("mentions")}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
