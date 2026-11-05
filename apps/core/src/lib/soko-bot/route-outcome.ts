import { SOKO_BOT_ROUTE_CAPABILITIES } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";

/** Tools every route already grants: using them says nothing about the route. */
const READS = new Set<string>(SOKO_BOT_ROUTE_CAPABILITIES.CLARIFY);

/**
 * One wide event per settled turn a person typed: Jev's route and signals
 * next to what the bot actually did. Where they disagree is where the
 * questions or thresholds need tuning — Jev guides, the bot decides, and this
 * shows how often the guide was right. No message text is logged.
 */
export async function logSokoBotRouteOutcome(turnId: string): Promise<void> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      sokoBotId: true,
      source: true,
      status: true,
      route: true,
      chainDepth: true,
      classification: true,
      toolCalls: {
        where: { status: "COMPLETED" },
        select: { capability: true },
      },
    },
  });
  if (!turn || turn.source !== "CHAT" || turn.chainDepth > 0) return;
  const classification = (turn.classification ?? {}) as {
    confidence?: number;
    signals?: Record<string, number>;
  };
  const writes = [
    ...new Set(
      turn.toolCalls
        .map((call) => call.capability)
        .filter((capability) => !READS.has(capability)),
    ),
  ];
  const routeReadsOnly =
    turn.route === "CLARIFY" || turn.route === "DIRECT_RESPONSE";
  const log = createCoreLogger({ operation: "soko_bot_route_outcome" });
  log.set({
    sokoBot: { id: turn.sokoBotId },
    turn: { id: turnId, status: turn.status },
    routeOutcome: {
      route: turn.route,
      confidence: classification.confidence ?? null,
      signals: classification.signals ?? null,
      writes,
      // The bot changed something on a route Jev read as talk, or Jev read a
      // change and the bot only talked.
      disagreed: routeReadsOnly ? writes.length > 0 : writes.length === 0,
    },
  });
  log.emit();
}
