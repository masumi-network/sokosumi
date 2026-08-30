import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

/**
 * What one bot has spent since it was created.
 *
 * Three separate model calls make up a turn — the agent loop, the classifier
 * that routes it and the judge that scores it — and only the first is billed.
 * `costUsd` is therefore what the tokens cost, `credits` is what the
 * owner actually paid, and they do not match: `sokoBotUsageCents` applies a
 * per-turn floor, so a turn costing a hundredth of a cent still bills the
 * minimum.
 */
export interface SokoBotUsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Every token the bot has spent, cache reads included. */
  totalTokens: number;
  /** What those tokens cost, agent loop plus classifier plus judge. */
  costUsd: number;
  /** The billed share of `costUsd` — the agent loop alone. */
  billableCostUsd: number;
  /**
   * What the owner was actually charged, from the usage ledger. Credits, not
   * cents: cents are the stored unit and never cross the API boundary.
   */
  credits: number;
}

interface UsageRow {
  turns: bigint;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsdMicros: bigint | null;
  overheadCostUsdMicros: bigint | null;
}

function asNumber(value: number | bigint | null): number {
  return value === null ? 0 : Number(value);
}

/**
 * Summed in SQL rather than in memory: a bot accumulates turns for as long as
 * it exists, and this is read on a page load.
 *
 * The token counts live inside the `usage` JSON because that column is the
 * per-turn record the API already returns, and duplicating them into scalar
 * columns would leave two things to keep in step. Postgres sums them directly.
 */
export async function sokoBotUsageTotals(
  sokoBotId: string,
): Promise<SokoBotUsageTotals> {
  const [row] = await prisma.$queryRaw<UsageRow[]>`
    SELECT
      COUNT(*)                                                          AS "turns",
      SUM(COALESCE(("usage" ->> 'inputTokens')::numeric, 0))::bigint    AS "inputTokens",
      SUM(COALESCE(("usage" ->> 'outputTokens')::numeric, 0))::bigint   AS "outputTokens",
      SUM(COALESCE(("usage" ->> 'cacheReadTokens')::numeric, 0))::bigint  AS "cacheReadTokens",
      SUM(COALESCE(("usage" ->> 'cacheWriteTokens')::numeric, 0))::bigint AS "cacheWriteTokens",
      SUM(COALESCE("costUsdMicros", 0))                                 AS "costUsdMicros",
      SUM(COALESCE("overheadCostUsdMicros", 0))                         AS "overheadCostUsdMicros"
    FROM "soko_bot_turn"
    WHERE "sokoBotId" = ${sokoBotId}::uuid
  `;

  const charged = await prisma.orchestratorUsage.aggregate({
    where: { orchestratorId: sokoBotId },
    _sum: { cents: true },
  });

  const inputTokens = asNumber(row?.inputTokens ?? null);
  const outputTokens = asNumber(row?.outputTokens ?? null);
  const cacheReadTokens = asNumber(row?.cacheReadTokens ?? null);
  const cacheWriteTokens = asNumber(row?.cacheWriteTokens ?? null);
  const billableMicros = asNumber(row?.costUsdMicros ?? null);
  const overheadMicros = asNumber(row?.overheadCostUsdMicros ?? null);

  return {
    turns: asNumber(row?.turns ?? null),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: (billableMicros + overheadMicros) / 1e6,
    billableCostUsd: billableMicros / 1e6,
    // Converted here rather than in the response producer so the only number
    // that leaves this service is already the user-facing one.
    credits: convertCentsToCredits(charged._sum.cents ?? 0n),
  };
}
