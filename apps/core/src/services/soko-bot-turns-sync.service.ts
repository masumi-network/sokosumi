import { randomUUID } from "node:crypto";

import { SokoBotTurnStatus } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  SOKO_BOT_START_RECOVERY_GRACE_MS,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";

const BATCH_SIZE = 20;
const TURN_LEASE_MS = 16 * 60 * 1_000;
export const SOKO_BOT_TURN_STALE_HEARTBEAT_MS = 45_000;
export const SOKO_BOT_TURN_STARTING_GRACE_MS = 30_000;
export const SOKO_BOT_TURN_STARTING_ABANDON_MS =
  SOKO_BOT_START_RECOVERY_GRACE_MS;

const ACTIVE_STATUSES = [
  SokoBotTurnStatus.QUEUED,
  SokoBotTurnStatus.STARTING,
  SokoBotTurnStatus.RUNNING,
  SokoBotTurnStatus.CANCEL_REQUESTED,
] as const;

export interface SokoBotTurnsSyncInput {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

export interface SokoBotTurnsSyncResult {
  claimed: number;
  reconciled: number;
  expired: number;
  interrupted: number;
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

    const now = new Date();
    result.expired += await this.expireTurns(
      await prisma.sokoBotTurn.findMany({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
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
          status: SokoBotTurnStatus.CANCEL_REQUESTED,
          eveSessionId: null,
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
    const abandonBefore = new Date(
      now.getTime() - SOKO_BOT_TURN_STARTING_ABANDON_MS,
    );
    const abandonedStarts = await prisma.sokoBotTurn.findMany({
      where: {
        status: SokoBotTurnStatus.STARTING,
        eveSessionId: null,
        reconcilerHeartbeatAt: null,
        createdAt: { lte: abandonBefore },
        deadlineAt: { gt: now },
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
    for (const outcome of recoveredStarts) {
      if (outcome.status === "fulfilled") {
        if (outcome.value) {
          result.claimed += 1;
          result.reconciled += 1;
        }
        continue;
      }
      result.interrupted += 1;
      console.warn("Soko Bot durable start recovery interrupted", {
        error:
          outcome.reason instanceof Error ? outcome.reason.message : "unknown",
      });
    }

    if (!input.shouldContinue()) return result;

    const staleBefore = new Date(
      now.getTime() - SOKO_BOT_TURN_STALE_HEARTBEAT_MS,
    );
    const graceBefore = new Date(
      now.getTime() - SOKO_BOT_TURN_STARTING_GRACE_MS,
    );
    const stale = await prisma.sokoBotTurn.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        deadlineAt: { gt: now },
        eveSessionId: { not: null },
        NOT: {
          status: SokoBotTurnStatus.STARTING,
          createdAt: { gt: graceBefore },
        },
        OR: [
          { reconcilerHeartbeatAt: { lte: staleBefore } },
          {
            reconcilerHeartbeatAt: null,
            status: { not: SokoBotTurnStatus.STARTING },
          },
          {
            reconcilerHeartbeatAt: null,
            status: SokoBotTurnStatus.STARTING,
            createdAt: { lte: graceBefore },
          },
        ],
      },
      select: { id: true, reconcilerHeartbeatAt: true },
      orderBy: [{ reconcilerHeartbeatAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });

    const claimed: { id: string; leaseToken: string }[] = [];
    for (const turn of stale) {
      if (!input.shouldContinue()) break;
      const claimedAt = new Date();
      const leaseToken = randomUUID();
      const updated = await prisma.sokoBotTurn.updateMany({
        where: {
          id: turn.id,
          status: { in: [...ACTIVE_STATUSES] },
          reconcilerHeartbeatAt: turn.reconcilerHeartbeatAt,
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(claimedAt.getTime() + TURN_LEASE_MS),
          reconcilerHeartbeatAt: claimedAt,
        },
      });
      if (updated.count === 0) continue;
      claimed.push({ id: turn.id, leaseToken });
    }
    result.claimed += claimed.length;
    if (claimed.length === 0) return result;

    const outcomes = await Promise.allSettled(
      claimed.map(({ id, leaseToken }) =>
        sokoBotControlPlane.reconcileTurn(id, input.abortSignal, leaseToken),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        result.reconciled += 1;
        continue;
      }
      result.interrupted += 1;
      console.warn("Soko Bot watchdog reconciliation interrupted", {
        error:
          outcome.reason instanceof Error ? outcome.reason.message : "unknown",
      });
    }

    return result;
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
