import { sokoBotTurnPurpose } from "@/lib/ai-gateway-purpose";
import prisma from "@/lib/db/prisma";

/**
 * Kept apart from the pure helpers so key lookups never pull in Prisma. Lane
 * membership is read fresh, never from `isEvalWorkspace`'s 60 second cache:
 * a stale "no" would bill a new lane's turns to a production key.
 */
export async function loadSokoBotTurnPurpose(turnId: string) {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { clientTurnId: true, versionId: true, workspaceId: true },
  });
  return sokoBotTurnPurpose(
    turn && {
      ...turn,
      inEvalLane: Boolean(
        await prisma.evalLane.findUnique({
          where: { workspaceId: turn.workspaceId },
          select: { lane: true },
        }),
      ),
    },
  );
}
