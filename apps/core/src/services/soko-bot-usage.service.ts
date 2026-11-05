import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import { roundCredits, taskCreditsCharged } from "@/lib/soko-bot/task-charges";

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
   * What the owner was actually charged for the bot's own turns, from the
   * usage ledger. Credits, not cents: cents are the stored unit and never
   * cross the API boundary.
   */
  credits: number;
  /** Charged on Coworker Tasks the bot created or assigned and Agents it hired. */
  delegatedCredits: number;
  /** `credits` plus `delegatedCredits`: everything the bot spent. */
  totalCredits: number;
}

/** Delegation actions that hand work to someone who charges for it. */
const SPENDING_TASK_ACTIONS = ["create_task", "assign_task"];

async function delegatedCreditsSpent(sokoBotId: string): Promise<number> {
  const delegations = await prisma.sokoBotDelegation.findMany({
    where: {
      turn: { sokoBotId },
      OR: [
        { taskId: { not: null }, action: { in: SPENDING_TASK_ACTIONS } },
        { jobId: { not: null }, action: "hire_agent" },
      ],
    },
    select: {
      taskId: true,
      job: {
        select: {
          transaction: { select: { amount: true } },
          refundedTransaction: { select: { amount: true } },
        },
      },
    },
  });
  const taskIds = [
    ...new Set(delegations.flatMap((d) => (d.taskId ? [d.taskId] : []))),
  ];
  let credits = 0;
  for (const charged of (await taskCreditsCharged(taskIds)).values())
    credits += charged;
  for (const { job } of delegations) {
    const net =
      -(job?.transaction?.amount ?? 0n) -
      (job?.refundedTransaction?.amount ?? 0n);
    if (net > 0n) credits += convertCentsToCredits(net);
  }
  return credits;
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

  const charged = await prisma.sokoBotUsage.aggregate({
    where: { sokoBotId: sokoBotId },
    _sum: { cents: true },
  });

  const ownCredits = convertCentsToCredits(charged._sum.cents ?? 0n);
  const delegatedCredits = await delegatedCreditsSpent(sokoBotId);

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
    credits: roundCredits(ownCredits),
    delegatedCredits: roundCredits(delegatedCredits),
    totalCredits: roundCredits(ownCredits + delegatedCredits),
  };
}

/**
 * One UTC day of the fleet: who wrote to a bot, and what the turns cost.
 * CMO.xyz bots (Cuso) are left out of every count and add up in `cmoCostUsd`.
 */
export interface SokoBotFleetDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** People whose own chat message started a turn; bot hops and lab runs excluded. */
  users: number;
  /** Turns those messages started. */
  messages: number;
  /** Every turn that day, background work included. */
  turns: number;
  totalTokens: number;
  /** Model cost of all turns: agent loop plus classifier plus judge. */
  costUsd: number;
  /** Model cost of CMO.xyz bot turns. */
  cmoCostUsd: number;
}

interface FleetDayRow {
  day: string;
  users: bigint;
  messages: bigint;
  turns: bigint;
  totalTokens: bigint | null;
  costUsdMicros: bigint | null;
  cmoCostUsdMicros: bigint | null;
}

/** The last `days` UTC days, oldest first, with empty days as zeros. */
export async function sokoBotFleetDays(
  days: number,
): Promise<SokoBotFleetDay[]> {
  const rows = await prisma.$queryRaw<FleetDayRow[]>`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => ${days - 1}),
        date_trunc('day', now() AT TIME ZONE 'UTC'),
        interval '1 day'
      ) AS day
    ),
    turns AS (
      SELECT
        date_trunc('day', t."createdAt") AS day,
        t."requestedByUserId",
        t."source" = 'CHAT'
          AND t."chainDepth" = 0
          AND t."parentTurnId" IS NULL
          AND t."requestedByUserId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "soko_bot_lab_run" l WHERE l."turnId" = t."id")
          AS "fromPerson",
        COALESCE((t."usage" ->> 'inputTokens')::numeric, 0)
          + COALESCE((t."usage" ->> 'outputTokens')::numeric, 0)
          + COALESCE((t."usage" ->> 'cacheReadTokens')::numeric, 0)
          + COALESCE((t."usage" ->> 'cacheWriteTokens')::numeric, 0) AS tokens,
        COALESCE(t."costUsdMicros", 0) + t."overheadCostUsdMicros" AS micros,
        b."versionId" IS NOT DISTINCT FROM ${CMO_SOKO_BOT_VERSION_ID} AS "cmo"
      FROM "soko_bot_turn" t
      JOIN "soko_bot" b ON b."id" = t."sokoBotId"
      WHERE t."createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => ${days - 1})
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS "day",
      COUNT(DISTINCT t."requestedByUserId") FILTER (WHERE t."fromPerson" AND NOT t."cmo") AS "users",
      COUNT(t.day) FILTER (WHERE t."fromPerson" AND NOT t."cmo") AS "messages",
      COUNT(t.day) FILTER (WHERE NOT t."cmo") AS "turns",
      SUM(t.tokens) FILTER (WHERE NOT t."cmo")::bigint AS "totalTokens",
      SUM(t.micros) FILTER (WHERE NOT t."cmo")::bigint AS "costUsdMicros",
      SUM(t.micros) FILTER (WHERE t."cmo")::bigint AS "cmoCostUsdMicros"
    FROM days d
    LEFT JOIN turns t ON t.day = d.day
    GROUP BY d.day
    ORDER BY d.day
  `;
  return rows.map((row) => ({
    day: row.day,
    users: Number(row.users),
    messages: Number(row.messages),
    turns: Number(row.turns),
    totalTokens: asNumber(row.totalTokens),
    costUsd: asNumber(row.costUsdMicros) / 1e6,
    cmoCostUsd: asNumber(row.cmoCostUsdMicros) / 1e6,
  }));
}
