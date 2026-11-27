import type { SokoBotSchedule, SokoBotScheduleRun } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
} from "@/lib/soko-bot/detached-network";
import type { StartSokoBotTurnInput } from "@/lib/soko-bot/turn-start";

type ScheduleSource = Pick<
  SokoBotSchedule,
  "id" | "jobId" | "network" | "preprodGeneration" | "workspaceId"
>;

export type ScheduledTurnProvenance = Pick<
  StartSokoBotTurnInput,
  "network" | "expectedPreprodGeneration"
>;

export async function scheduleTurnProvenance(
  schedule: ScheduleSource,
): Promise<ScheduledTurnProvenance> {
  if (schedule.jobId == null) {
    return { network: createNetworkScope("mainnet").network };
  }
  if (schedule.network == null) throw staleScheduleNetwork();
  const scope = await detachedNetworkScope(schedule);
  if (scope.network === "mainnet") return { network: scope.network };

  const job = await scope.networkDb.job.findFirst({
    where: { id: schedule.jobId, workspaceId: schedule.workspaceId },
    select: { id: true },
  });
  if (!job) throw staleScheduleNetwork();
  return {
    network: scope.network,
    expectedPreprodGeneration: schedule.preprodGeneration,
  };
}

function staleScheduleNetwork() {
  return new DetachedNetworkRefusal(
    CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE,
  );
}

export function requireScheduledTurnProvenance(
  expected: ScheduledTurnProvenance,
  stored: { network: string | null; preprodGeneration?: number | null },
): void {
  if (
    expected.expectedPreprodGeneration !== undefined &&
    (expected.network !== stored.network ||
      expected.expectedPreprodGeneration !== stored.preprodGeneration)
  ) {
    throw staleScheduleNetwork();
  }
}

/** The writer's existing pause fence can refuse a turn after pickup. */
export function isTemporaryScheduleRefusal(
  schedule: Pick<ScheduleSource, "jobId" | "network">,
  error: unknown,
): boolean {
  if (error instanceof DetachedNetworkRefusal) return !error.final;
  return (
    schedule.jobId != null &&
    schedule.network === "preprod" &&
    error instanceof HTTPException &&
    error.status === 503
  );
}

type ScheduleRunClaim = Pick<
  SokoBotScheduleRun,
  "id" | "status" | "attempt" | "leaseToken" | "leaseExpiresAt" | "turnId"
>;

function staleScheduleRunData() {
  const error = staleScheduleNetwork();
  return {
    status: "FAILED" as const,
    completedAt: new Date(),
    leaseToken: null,
    leaseExpiresAt: null,
    errorKind: error.kind,
    errorDetail: error.message,
  };
}

/** A stale schedule cannot start a later occurrence either. */
export async function finishStaleSchedule(
  schedule: ScheduleSource,
  run?: ScheduleRunClaim,
): Promise<boolean> {
  const where = {
    id: schedule.id,
    network: schedule.network,
    preprodGeneration: schedule.preprodGeneration,
    jobId: schedule.jobId,
  };
  if (!run) {
    const disabled = await prisma.sokoBotSchedule.updateMany({
      where,
      data: { enabled: false },
    });
    return disabled.count === 1;
  }
  return prisma.$transaction(async (tx) => {
    const { id, status, attempt, leaseToken, leaseExpiresAt, turnId } = run;
    // Settlement takes the run before updating its schedule.
    const finished = await tx.sokoBotScheduleRun.updateMany({
      where: {
        id,
        status,
        attempt,
        leaseToken,
        leaseExpiresAt,
        turnId,
        schedule: where,
      },
      data: staleScheduleRunData(),
    });
    if (finished.count !== 1) return false;
    await tx.sokoBotSchedule.updateMany({ where, data: { enabled: false } });
    return true;
  });
}
