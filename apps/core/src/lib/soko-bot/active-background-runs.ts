import { SokoBotTurnStatus } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

/**
 * A chat turn is told which of the bot's runs are still working. Without it,
 * "stopped" got "I'll stop here" while a six-hour run kept going: the chat
 * turn never knew the run existed.
 */
export async function withActiveBackgroundRuns(
  turnId: string,
  text: string,
): Promise<string> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { sokoBotId: true, parentTurnId: true },
  });
  if (!turn || turn.parentTurnId) return text;
  const runs = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: turn.sokoBotId,
      parentTurnId: { not: null },
      status: {
        in: [
          SokoBotTurnStatus.QUEUED,
          SokoBotTurnStatus.STARTING,
          SokoBotTurnStatus.RUNNING,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, backgroundTitle: true, createdAt: true },
  });
  if (!runs.length) return text;
  const lines = runs.map(
    (run) =>
      `- "${run.backgroundTitle}" (runId ${run.id}, started ${run.createdAt.toISOString()})`,
  );
  return `${text}\n\n[Your background runs still working. When the owner calls one off or changes the plan, stop it with stop_background_run; saying you stopped is not enough.\n${lines.join("\n")}]`;
}
