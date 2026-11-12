import type { Prisma } from "@sokosumi/database";

import { unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

import { AD_EVAL_RESERVATION_USD_MICROS } from "./ad-eval-judge";

interface ReserveAdEvalInput {
  assetId: string;
  workspaceId: string;
  rubricVersion: string;
  workspaceDailyLimit: number;
  globalDailyUsd: number;
  now?: Date;
}

interface FinalizeAdEvalInput {
  id: string;
  checks: Prisma.InputJsonValue;
  judge: Prisma.InputJsonValue;
  judgeModel: string;
  overall: number;
  costUsdMicros: bigint | null;
  latencyMs: number;
}

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Reserve spend before dispatch; unfinished calls retain their reservation. */
export async function reserveAdEval(
  input: ReserveAdEvalInput,
): Promise<string | null> {
  const globalDailyMicros = Math.floor(input.globalDailyUsd * 1_000_000);
  if (
    !Number.isSafeInteger(input.workspaceDailyLimit) ||
    input.workspaceDailyLimit <= 0 ||
    !Number.isSafeInteger(globalDailyMicros) ||
    globalDailyMicros <= 0
  ) {
    return null;
  }

  try {
    return await serializableTransaction(async (tx) => {
      const createdAt = input.now ?? new Date();
      const day = utcDay(createdAt);

      const existing = await tx.adEval.findUnique({
        where: {
          assetId_rubricVersion: {
            assetId: input.assetId,
            rubricVersion: input.rubricVersion,
          },
        },
        select: { id: true },
      });
      if (existing) return null;

      const global = await tx.adEvalDailyBudget.upsert({
        where: { day_scope: { day, scope: "global" } },
        create: { day, scope: "global" },
        update: { calls: { increment: 0 } },
      });
      if (
        global.costUsdMicros + AD_EVAL_RESERVATION_USD_MICROS >
        BigInt(globalDailyMicros)
      ) {
        return null;
      }

      const workspace = await tx.adEvalDailyBudget.upsert({
        where: { day_scope: { day, scope: input.workspaceId } },
        create: {
          day,
          scope: input.workspaceId,
          workspaceId: input.workspaceId,
        },
        update: { calls: { increment: 0 } },
      });
      if (workspace.calls >= input.workspaceDailyLimit) return null;

      // The global row serializes admissions across processes and survives deletion.
      for (const scope of ["global", input.workspaceId]) {
        await tx.adEvalDailyBudget.update({
          where: { day_scope: { day, scope } },
          data: {
            calls: { increment: 1 },
            costUsdMicros: { increment: AD_EVAL_RESERVATION_USD_MICROS },
          },
        });
      }
      const row = await tx.adEval.create({
        data: {
          assetId: input.assetId,
          workspaceId: input.workspaceId,
          rubricVersion: input.rubricVersion,
          checks: [],
          costUsdMicros: AD_EVAL_RESERVATION_USD_MICROS,
          createdAt,
        },
        select: { id: true },
      });
      return row.id;
    }, "Ad evaluation admission conflicted");
  } catch (error) {
    if (isPrismaUniqueViolation(error)) return null;
    throw error;
  }
}

/** Reconcile known spend once, retaining unpriced or deleted calls' reservations. */
export async function finalizeAdEval(
  input: FinalizeAdEvalInput,
): Promise<void> {
  await serializableTransaction(async (tx) => {
    const row = await tx.adEval.findUnique({
      where: { id: input.id },
      select: { workspaceId: true, createdAt: true, costUsdMicros: true },
    });
    if (!row) return;

    if (input.costUsdMicros !== null) {
      if (input.costUsdMicros < 0n) {
        throw unprocessableEntity("Ad eval cost is negative");
      }
      const difference =
        input.costUsdMicros -
        (row.costUsdMicros ?? AD_EVAL_RESERVATION_USD_MICROS);
      if (difference !== 0n) {
        const day = utcDay(row.createdAt);
        for (const scope of ["global", row.workspaceId]) {
          await tx.adEvalDailyBudget.update({
            where: { day_scope: { day, scope } },
            data: { costUsdMicros: { increment: difference } },
          });
        }
      }
    }
    await tx.adEval.update({
      where: { id: input.id },
      data: {
        checks: input.checks,
        judge: input.judge,
        judgeModel: input.judgeModel,
        overall: input.overall,
        latencyMs: input.latencyMs,
        ...(input.costUsdMicros === null
          ? {}
          : { costUsdMicros: input.costUsdMicros }),
      },
    });
  }, "Ad evaluation finalization conflicted");
}
