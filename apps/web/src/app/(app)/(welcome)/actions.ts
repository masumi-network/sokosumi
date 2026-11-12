"use server";

import { z } from "zod";
import { taskService } from "@/lib/services/task.service";

import {
  listOverdue,
  loadMyDay,
  MOVE_OVERDUE_LIMIT,
  type MyDayPage,
} from "./components/my-day";

/**
 * The next page of Home's My day: the same Core query, for the same day,
 * from `cursor`. Null on failure; the list says so and keeps its rows.
 */
export async function loadMoreMyDay({
  today,
  cursor,
}: {
  today: string;
  cursor: string;
}): Promise<MyDayPage | null> {
  return loadMyDay(today, cursor);
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A Task a move re-dated, and the due day it had before. */
export interface MovedTask {
  id: string;
  from: string;
}

/**
 * What a move did: the Tasks it re-dated and how many it tried. Fewer moved
 * than tried means Core skipped some (changed since, or not the reader's to
 * edit).
 */
export interface MoveOverdueResult {
  moved: MovedTask[];
  tried: number;
}

/**
 * Re-dates the reader's overdue Tasks (as of their `today`) to `to`. Core
 * moves each one only while it still has the due day read here.
 * Null on failure.
 */
export async function moveOverdueTasks(input: {
  today: string;
  to: string;
}): Promise<MoveOverdueResult | null> {
  const parsed = z.object({ today: day, to: day }).safeParse(input);
  if (!parsed.success) return null;
  const { today, to } = parsed.data;
  try {
    const { tasks } = await listOverdue(today);
    const overdue = tasks.flatMap((task) =>
      task.dueOn ? [{ id: task.id, from: task.dueOn }] : [],
    );
    if (overdue.length === 0) return { moved: [], tried: 0 };
    const movedIds = new Set(
      await taskService.moveTaskDueDates(
        overdue.map((task) => ({ ...task, to })),
      ),
    );
    return {
      moved: overdue.filter((task) => movedIds.has(task.id)),
      tried: overdue.length,
    };
  } catch (error) {
    console.warn("Move overdue failed", { error });
    return null;
  }
}

/**
 * Undo of a move: puts each Task back on its old due day, but only while it
 * is still on `to`, so a change someone made since is kept. Returns how many
 * went back, or null on failure.
 */
export async function undoMoveOverdueTasks(input: {
  to: string;
  moved: MovedTask[];
}): Promise<number | null> {
  const parsed = z
    .object({
      to: day,
      moved: z
        .array(z.object({ id: z.string().min(1), from: day }))
        .min(1)
        .max(MOVE_OVERDUE_LIMIT),
    })
    .safeParse(input);
  if (!parsed.success) return null;
  const { to, moved } = parsed.data;
  try {
    const restored = await taskService.moveTaskDueDates(
      moved.map((task) => ({ id: task.id, from: to, to: task.from })),
    );
    return restored.length;
  } catch (error) {
    console.warn("Undo move overdue failed", { error });
    return null;
  }
}
