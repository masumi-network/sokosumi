import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";

/**
 * Whether a Soko Bot turn is still running, read from its progress, so a
 * caller can wait for it or offer a retry. Shared by CMO's cards and the
 * Marketing strategy's approval.
 */

/**
 * Learning that shows no progress for this long is stuck: a healthy turn
 * writes an event every few seconds and ends within the runtime's budget.
 */
const LEARNING_STALL_MS = 5 * 60 * 1_000;

export type SettledTurnStatus = "running" | "failed" | "done";

/**
 * Milliseconds since the turn's last progress, each on its own clock: a
 * runtime event's time (the runtime's) against the caller's `now`, the
 * turn's `createdAt` (PostgreSQL's) against PostgreSQL time.
 */
async function msSinceTurnProgress(
  turn: { eveSessionId: string | null; createdAt: Date },
  now: Date,
): Promise<number> {
  const latest = turn.eveSessionId
    ? await prisma.sokoBotRuntimeEvent.findFirst({
        where: { sessionId: turn.eveSessionId },
        orderBy: { startIndex: "desc" },
        select: { occurredAt: true },
      })
    : null;
  if (latest) return now.getTime() - latest.occurredAt.getTime();
  return (await databaseNow()).getTime() - turn.createdAt.getTime();
}

/**
 * Reads the newest onboarding turn. A stuck one (its run died, e.g. with
 * the process that ran it) is settled as failed here, as a deadline would,
 * so the founder sees "Try again" instead of a spinner and the bot is free
 * for new turns.
 */
type TurnRow = {
  id: string;
  status: string;
  eveSessionId: string | null;
  createdAt: Date;
  clientTurnId: string | null;
};

/**
 * running, done or failed. A turn that stopped making progress (its run died
 * with the process that ran it) is settled as failed here, as a deadline
 * would, so the founder sees "Try again" instead of a spinner.
 */
export async function settledTurnStatus(
  turn: TurnRow,
  now: Date,
): Promise<SettledTurnStatus> {
  if (turn.status === "COMPLETED") return "done";
  if (turn.status === "FAILED" || turn.status === "CANCELLED") return "failed";
  if ((await msSinceTurnProgress(turn, now)) < LEARNING_STALL_MS) {
    return "running";
  }
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  await sokoBotControlPlane.expireTurn(turn.id).catch(() => undefined);
  return "failed";
}

export const TURN_ROW_SELECT = {
  id: true,
  status: true,
  eveSessionId: true,
  createdAt: true,
  clientTurnId: true,
} as const;
