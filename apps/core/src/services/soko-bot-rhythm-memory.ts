import { parseSokoBotMemory } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { memoryTasks, tasksIn } from "@/lib/soko-bot/memory-task-ownership";
import type { RhythmBot } from "./soko-bot-rhythms.service";

export async function latestMemory(bot: RhythmBot): Promise<string | null> {
  const revision = await prisma.sokoBotMemoryRevision.findFirst({
    where: { sokoBotId: bot.id },
    orderBy: { version: "desc" },
    select: { markdown: true },
  });
  return revision?.markdown ?? null;
}

/** Follow-ups that are the owner's: none about a teammate's Task. */
export async function memoryFollowUps(bot: RhythmBot): Promise<string[]> {
  const markdown = await latestMemory(bot);
  if (!markdown) return [];
  const followUps = parseSokoBotMemory(markdown).followUps;
  const known = await memoryTasks(followUps, bot);
  return followUps.filter(
    (entry) => !tasksIn(entry, known).some((task) => task.foreign),
  );
}
