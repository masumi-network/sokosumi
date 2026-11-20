import { randomUUID } from "node:crypto";
import { SokoBotTurnStatus } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { createCoreLogger, logCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import {
  ACTIVE_TURN_STATUSES,
  sokoBotControlPlane,
  staleTurnLeaseWhere,
  startRecoveryEligibility,
  TURN_LEASE_MS,
} from "@/services/soko-bot-control-plane.service";

const BATCH_SIZE = 20;

interface TurnLeaseClaim {
  id: string;
  leaseToken: string;
}

export interface SokoBotTurnsSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
  /** Only these bots' turns; every bot's when left out. */
  sokoBotIds?: readonly string[];
}

export interface SokoBotTurnsSyncResult {
  claimed: number;
  reconciled: number;
  expired: number;
  interrupted: number;
}

/**
 * The turns cron runs after its response, so each turn it could not pick up
 * is its own event. The turn stays active; the next tick tries again.
 */
function logInterrupted(
  turnId: string | undefined,
  reason: unknown,
  warning: { message: string; why: string },
): void {
  const log = createCoreLogger({
    operation: "soko_bot_turns_sync",
    turn: { id: turnId },
  });
  logCoreWarning(
    log,
    {
      message: warning.message,
      why: warning.why,
      fix: "The next soko-bot-turns sync tries the turn again, and its deadline expires it if it never recovers.",
    },
    // Only safe fields: turn work can echo its prompt.
    { failure: messageSafeErrorFields(reason) },
  );
  log.emit();
}

export class SokoBotTurnsSyncService {
  async syncActiveTurns(
    input: SokoBotTurnsSyncInput,
  ): Promise<SokoBotTurnsSyncResult> {
    const result: SokoBotTurnsSyncResult = {
      claimed: 0,
      reconciled: 0,
      expired: 0,
      interrupted: 0,
    };
    if (!getEnv().SOKO_BOT_ENABLED) return result;
    if (!input.shouldContinue()) return result;

    const scope = input.sokoBotIds
      ? { sokoBotId: { in: [...input.sokoBotIds] } }
      : {};
    const now = await databaseNow();
    result.expired += await this.expireTurns(
      await prisma.sokoBotTurn.findMany({
        where: {
          ...scope,
          status: { in: [...ACTIVE_TURN_STATUSES] },
          deadlineAt: { lte: now },
        },
        select: { id: true },
        orderBy: [{ deadlineAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      }),
    );

    if (!input.shouldContinue()) return result;

    result.expired += await this.settleUndeliverableCancellations(
      await prisma.sokoBotTurn.findMany({
        where: {
          ...scope,
          status: SokoBotTurnStatus.CANCEL_REQUESTED,
          eveSessionId: null,
          ...staleTurnLeaseWhere(now),
        },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      }),
    );

    if (!input.shouldContinue()) return result;

    // A process can disappear after committing STARTING but before Eve create.
    // Replay these turns with their immutable turn id instead of expiring the
    // user's message. recoverStartingTurn owns the lease CAS.
    const recoveryNow = await databaseNow();
    const abandonedStarts = await prisma.sokoBotTurn.findMany({
      where: {
        ...scope,
        status: SokoBotTurnStatus.STARTING,
        eveSessionId: null,
        deadlineAt: { gt: recoveryNow },
        AND: [staleTurnLeaseWhere(recoveryNow), startRecoveryEligibility()],
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    const startsToRecover: Array<{ id: string }> = [];
    for (const turn of abandonedStarts) {
      if (!input.shouldContinue()) break;
      startsToRecover.push(turn);
    }
    const recoveredStarts = await Promise.allSettled(
      startsToRecover.map((turn) =>
        sokoBotControlPlane.recoverStartingTurn(turn.id),
      ),
    );
    const recoveredClaims: TurnLeaseClaim[] = [];
    for (const [index, outcome] of recoveredStarts.entries()) {
      if (outcome.status === "fulfilled") {
        if (outcome.value?.reconciliationLeaseToken) {
          recoveredClaims.push({
            id: outcome.value.turnId,
            leaseToken: outcome.value.reconciliationLeaseToken,
          });
        }
        continue;
      }
      const turnId = startsToRecover[index]?.id;
      if (
        turnId &&
        reportSokoBotReconciliationLeaseLoss(turnId, outcome.reason)
      )
        continue;
      result.interrupted += 1;
      logInterrupted(turnId, outcome.reason, {
        message: "Could not recover a Soko Bot turn whose start was abandoned",
        why: "Recovering the start threw",
      });
    }

    const recoveredDrain = this.drainClaims(
      recoveredClaims,
      input.abortSignal,
      result,
    );
    try {
      if (input.shouldContinue()) {
        const staleClaims = await this.claimStaleTurns(scope, input);
        await this.drainClaims(staleClaims, input.abortSignal, result);
      }
    } finally {
      await recoveredDrain;
    }
    return result;
  }

  private async claimStaleTurns(
    scope: { sokoBotId?: { in: string[] } },
    input: SokoBotTurnsSyncInput,
  ): Promise<TurnLeaseClaim[]> {
    const drainScanAt = await databaseNow();
    const stale = await prisma.sokoBotTurn.findMany({
      where: {
        ...scope,
        status: { in: [...ACTIVE_TURN_STATUSES] },
        deadlineAt: { gt: drainScanAt },
        eveSessionId: { not: null },
        ...staleTurnLeaseWhere(drainScanAt),
      },
      select: {
        id: true,
        eveSessionId: true,
        leaseToken: true,
        reconcilerHeartbeatAt: true,
      },
      orderBy: [{ reconcilerHeartbeatAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });

    const claimed: TurnLeaseClaim[] = [];
    for (const turn of stale) {
      if (!input.shouldContinue()) break;
      const leaseToken = randomUUID();
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "soko_bot_turn" WHERE "id" = ${turn.id}::uuid
          FOR NO KEY UPDATE
        `;
        const claimedAt = await databaseNow(tx);
        return tx.sokoBotTurn.updateMany({
          where: {
            ...turn,
            status: { in: [...ACTIVE_TURN_STATUSES] },
            deadlineAt: { gt: claimedAt },
            ...staleTurnLeaseWhere(claimedAt),
          },
          data: {
            leaseToken,
            leaseExpiresAt: new Date(claimedAt.getTime() + TURN_LEASE_MS),
            reconcilerHeartbeatAt: claimedAt,
          },
        });
      });
      if (updated.count === 0) continue;
      claimed.push({ id: turn.id, leaseToken });
    }
    return claimed;
  }

  private async drainClaims(
    claimed: TurnLeaseClaim[],
    abortSignal: AbortSignal,
    result: SokoBotTurnsSyncResult,
  ): Promise<void> {
    result.claimed += claimed.length;

    const outcomes = await Promise.allSettled(
      claimed.map(({ id, leaseToken }) =>
        sokoBotControlPlane.reconcileTurn(id, abortSignal, leaseToken),
      ),
    );
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === "fulfilled") {
        result.reconciled += 1;
        continue;
      }
      const turnId = claimed[index]?.id;
      if (
        turnId &&
        reportSokoBotReconciliationLeaseLoss(turnId, outcome.reason)
      )
        continue;
      result.interrupted += 1;
      logInterrupted(turnId, outcome.reason, {
        message: "Could not resume a stalled Soko Bot turn",
        why: "Turn reconciliation threw",
      });
    }
  }

  private async expireTurns(turns: Array<{ id: string }>): Promise<number> {
    if (turns.length === 0) return 0;
    const outcomes = await Promise.allSettled(
      turns.map((turn) => sokoBotControlPlane.expireTurn(turn.id)),
    );
    let expired = 0;
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value) expired += 1;
    }
    return expired;
  }

  private async settleUndeliverableCancellations(
    turns: Array<{ id: string }>,
  ): Promise<number> {
    if (turns.length === 0) return 0;
    const outcomes = await Promise.allSettled(
      turns.map((turn) =>
        sokoBotControlPlane.settleUndeliverableCancellation(turn.id),
      ),
    );
    return outcomes.filter(
      (outcome) => outcome.status === "fulfilled" && outcome.value,
    ).length;
  }
}

export const sokoBotTurnsSyncService = new SokoBotTurnsSyncService();
