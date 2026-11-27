import {
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_TOOL_REFUSED,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import { recordDecisionOutcome } from "./decision-receipts";
import { RuntimeEventLog } from "./turn-loop";

/** Tools every route already grants: using them says nothing about the route. */
const READS = new Set<string>(SOKO_BOT_ROUTE_CAPABILITIES.CLARIFY);

function numberField(record: unknown, key: string): number {
  if (!record || typeof record !== "object") return 0;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * One wide event per settled turn a person typed: Jev's route and signals
 * next to what the bot actually did. Where they disagree is where the
 * questions or thresholds need tuning — Jev guides, the bot decides, and this
 * shows how often the guide was right. No message text is logged.
 *
 * When the turn's version opts into `decisionReceipts`, also records a bounded
 * `decision.outcome` runtime event so offline replay sees task outcome, cost,
 * and latency next to the turn's selector receipts.
 */
export async function logSokoBotRouteOutcome(turnId: string): Promise<void> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      sokoBotId: true,
      versionId: true,
      eveSessionId: true,
      source: true,
      status: true,
      route: true,
      chainDepth: true,
      classification: true,
      usage: true,
      durationMs: true,
      toolCalls: {
        select: { capability: true, status: true, errorKind: true },
      },
    },
  });
  if (!turn) return;
  const completedCalls = turn.toolCalls.filter(
    (call) => call.status === "COMPLETED",
  );
  const writes = [
    ...new Set(
      completedCalls
        .map((call) => call.capability)
        .filter((capability) => !READS.has(capability)),
    ),
  ];
  const routeReadsOnly =
    turn.route === "CLARIFY" || turn.route === "DIRECT_RESPONSE";
  const disagreed =
    turn.route === null
      ? null
      : routeReadsOnly
        ? writes.length > 0
        : writes.length === 0;

  if (
    turn.versionId &&
    turn.eveSessionId &&
    (await resolveSokoBotVersion(turn.versionId)).decisionReceipts === true
  ) {
    const toolRefusals = turn.toolCalls.filter(
      (call) => call.errorKind === SOKO_BOT_TOOL_REFUSED,
    ).length;
    const toolErrors = turn.toolCalls.filter(
      (call) =>
        call.status === "FAILED" && call.errorKind !== SOKO_BOT_TOOL_REFUSED,
    ).length;
    await recordDecisionOutcome(
      new RuntimeEventLog(turnId, turn.eveSessionId),
      {
        schemaVersion: 1,
        turnId,
        recordedAt: new Date().toISOString(),
        turnStatus: turn.status,
        writes,
        toolCallCount: turn.toolCalls.length,
        toolErrors,
        toolRefusals,
        routeDisagreed: disagreed,
        inputTokens: Math.round(numberField(turn.usage, "inputTokens")),
        outputTokens: Math.round(numberField(turn.usage, "outputTokens")),
        turnCostUsd: numberField(turn.usage, "costUsd"),
        turnDurationMs:
          typeof turn.durationMs === "number" && turn.durationMs >= 0
            ? turn.durationMs
            : null,
      },
    );
  }

  if (turn.source !== "CHAT" || turn.chainDepth > 0) return;
  const classification = (turn.classification ?? {}) as {
    confidence?: number;
    signals?: Record<string, number>;
  };
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
      disagreed: disagreed ?? false,
    },
  });
  log.emit();
}
