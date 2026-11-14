import prisma from "@/lib/db/prisma";
import { isEvalWorkspace } from "./eval-guard";

/** Retain diagnostics, but do not feed an earlier eval world to its next run. */
export async function evalHistoryFloor(input: {
  workspaceId: string;
  sokoBotId: string;
}): Promise<Date | null> {
  if (!(await isEvalWorkspace(input.workspaceId))) return null;
  const lane = await prisma.evalLane.findUnique({
    where: { workspaceId: input.workspaceId },
    select: { sokoBotId: true, cusoBotId: true },
  });
  if (!lane || ![lane.sokoBotId, lane.cusoBotId].includes(input.sokoBotId))
    return null;
  const reset = await prisma.sokoBotMemoryRevision.findFirst({
    where: {
      sokoBotId: input.sokoBotId,
      source: "user_reset",
      sokoBot: { workspaceId: input.workspaceId },
    },
    orderBy: { version: "desc" },
    select: { createdAt: true },
  });
  return reset?.createdAt ?? null;
}
