"use server";

import { z } from "zod";
import { taskService } from "@/lib/services/task.service";

import { loadMyDay, type MyDayPage } from "./components/my-day";

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

/** A Task a move re-dated: its old due day, and the version Undo needs. */
export interface MovedTask {
  id: string;
  from: string;
  version: string;
}

/**
 * What a move did. `skipped` Tasks kept their day: they changed meanwhile,
 * aren't the reader's to edit, or failed.
 */
export interface MoveOverdueResult {
  moved: MovedTask[];
  skipped: number;
}

/**
 * Re-dates the reader's overdue Tasks (as of their `today`) to `to`. Core
 * picks them and re-checks each under lock. Null on failure.
 */
export async function moveOverdueTasks(input: {
  today: string;
  to: string;
}): Promise<MoveOverdueResult | null> {
  const parsed = z.object({ today: day, to: day }).safeParse(input);
  if (!parsed.success) return null;
  try {
    return await taskService.moveOverdueTasks(parsed.data);
  } catch (error) {
    console.warn("Move overdue failed", { error });
    return null;
  }
}

/**
 * Undo of a move: puts each Task back on its old day only while it is
 * untouched since the move, so a change someone made since is kept. Null on
 * failure.
 */
export async function undoMoveOverdueTasks(input: {
  to: string;
  moved: MovedTask[];
}): Promise<{ restored: number; skipped: number } | null> {
  const parsed = z
    .object({
      to: day,
      moved: z
        .array(
          z.object({ id: z.string().min(1), from: day, version: z.string() }),
        )
        .min(1)
        .max(100),
    })
    .safeParse(input);
  if (!parsed.success) return null;
  try {
    const { restored, skipped } = await taskService.undoMoveOverdueTasks({
      to: parsed.data.to,
      tasks: parsed.data.moved,
    });
    return { restored: restored.length, skipped };
  } catch (error) {
    console.warn("Undo move overdue failed", { error });
    return null;
  }
}
