import { sokoBotTurnPurpose } from "@/lib/ai-gateway-purpose";
import prisma from "@/lib/db/prisma";
import { isEvalWorkspace } from "@/lib/evals/eval-guard";

/** Kept apart from the pure helpers so key lookups never pull in Prisma. */
export async function loadSokoBotTurnPurpose(turnId: string) {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { clientTurnId: true, versionId: true, workspaceId: true },
  });
  return sokoBotTurnPurpose(
    turn && {
      ...turn,
      inEvalLane: await isEvalWorkspace(turn.workspaceId),
    },
  );
}
