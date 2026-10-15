import { isResponsibleUser } from "@/helpers/task-visibility";
import {
  pickResponsibleUser,
  responsibleUserNameSelect,
} from "@/helpers/work-creator";
import prisma from "@/lib/db/prisma";

export const TASK_ID_IN_TEXT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export interface MemoryTask {
  id: string;
  name: string;
  /** The responsible person's name (ADR 0056). */
  responsibleName: string;
  /** Neither the bot's person's responsibility nor assigned to the bot. */
  foreign: boolean;
  closed: boolean;
}

/**
 * The Tasks a bot's memory names by id, with whose they are. Memory is free
 * text the bot wrote itself: while bots followed the whole board, Jarvis
 * filed a teammate's Tasks as his owner's goals and follow-ups, and every
 * stand-up then asked the owner about them.
 */
export async function memoryTasks(
  texts: readonly string[],
  bot: { id: string; userId: string },
): Promise<Map<string, MemoryTask>> {
  const ids = [
    ...new Set(
      texts.flatMap((text) =>
        (text.match(TASK_ID_IN_TEXT) ?? []).map((id) => id.toLowerCase()),
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      status: true,
      archivedAt: true,
      assigneeSokoBotId: true,
      ...responsibleUserNameSelect,
    },
  });
  return new Map(
    tasks.map((task) => [
      task.id.toLowerCase(),
      {
        id: task.id,
        name: task.name ?? "Untitled task",
        responsibleName:
          pickResponsibleUser(task)?.name?.trim() || "a teammate",
        foreign:
          !isResponsibleUser(task, bot.userId) &&
          task.assigneeSokoBotId !== bot.id,
        closed:
          task.archivedAt !== null ||
          task.status === "COMPLETED" ||
          task.status === "CANCELED",
      },
    ]),
  );
}

export function tasksIn(
  text: string,
  known: Map<string, MemoryTask>,
): MemoryTask[] {
  return (text.match(TASK_ID_IN_TEXT) ?? []).flatMap((id) => {
    const task = known.get(id.toLowerCase());
    return task ? [task] : [];
  });
}

/** Packet lines for Tasks in memory that are someone else's. */
export function foreignTasksBlock(known: Map<string, MemoryTask>): string[] {
  const foreign = [...known.values()].filter(
    (task) => task.foreign && !task.closed,
  );
  if (foreign.length === 0) return [];
  return [
    "## Named in your memory, but not your owner's Tasks",
    ...foreign.map(
      (task) =>
        `- "${task.name}" (id ${task.id}) belongs to ${task.responsibleName}.`,
    ),
    "These are not your owner's to answer: never present them as theirs. Remove them from your goals, decisions, blockers and follow-ups.",
    "",
  ];
}
