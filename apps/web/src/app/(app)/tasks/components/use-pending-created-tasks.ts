"use client";

import { startTransition, useEffect, useOptimistic } from "react";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { createTask } from "@/lib/actions/task/action";
import type { TaskFormCreateHandler, TaskFormCreateInput } from "./task-form";

type ShowPendingTask = (input: TaskFormCreateInput) => void;

/**
 * Set by the mounted tasks view. The create form can live outside it (the
 * app-wide New task wizard), so a module slot joins the two.
 */
let showPendingTask: ShowPendingTask | null = null;

const NO_PENDING_TASKS: TaskWithCoworker[] = [];

/**
 * Board rows with the Tasks that are being created in front. A pending row
 * lives only for the create request: React drops it in the commit that
 * brings the revalidated `tasks` prop, or alone when the create fails.
 */
export function usePendingCreatedTasks(
  items: TaskWithCoworker[],
  buildPendingTask: (input: TaskFormCreateInput) => TaskWithCoworker,
): TaskWithCoworker[] {
  const [pendingTasks, addPendingTask] = useOptimistic(
    NO_PENDING_TASKS,
    (current, task: TaskWithCoworker) => [task, ...current],
  );

  useEffect(() => {
    const show: ShowPendingTask = (input) =>
      addPendingTask(buildPendingTask(input));
    showPendingTask = show;
    return () => {
      if (showPendingTask === show) showPendingTask = null;
    };
  }, [addPendingTask, buildPendingTask]);

  return pendingTasks.length > 0 ? [...pendingTasks, ...items] : items;
}

/**
 * A create that also shows its pending row on a mounted tasks view. The
 * transition is what keeps the row up until the create has an answer.
 */
export function withBoardPreview(
  createTaskHandler: TaskFormCreateHandler = createTask,
): TaskFormCreateHandler {
  return (input) =>
    new Promise((resolve, reject) => {
      startTransition(async () => {
        try {
          // Display only: a failure here must not stop the create.
          showPendingTask?.(input);
        } catch {}
        try {
          resolve(await createTaskHandler(input));
        } catch (error) {
          reject(error);
        }
      });
    });
}
