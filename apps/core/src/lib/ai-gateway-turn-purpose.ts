import { sokoBotTurnPurpose } from "@/lib/ai-gateway-purpose";
import prisma from "@/lib/db/prisma";

/** Kept apart from the pure helpers so key lookups never pull in Prisma. */
export async function loadSokoBotTurnPurpose(turnId: string) {
  return sokoBotTurnPurpose(
    await prisma.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { clientTurnId: true, versionId: true },
    }),
  );
}
