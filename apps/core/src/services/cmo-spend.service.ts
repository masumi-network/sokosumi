import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

export interface CmoSpendLine {
  /** A model id, "web_search" or "exa/search". */
  source: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CmoSpend {
  sokoBotId: string;
  businessName: string;
  ownerEmail: string;
  turns: number;
  /** What Cuso's work cost us: his loop, search, Exa and overhead. */
  totalUsd: number;
  /** The routing classifier and the quality judge; not billed to the owner. */
  overheadUsd: number;
  /** Credits charged for images he made. */
  imagesCredits: number;
  /** Credits charged to the owner: his turns plus the images he made. */
  chargedCredits: number;
  bySource: CmoSpendLine[];
  /** Tool calls per tool, most used first. */
  tools: { capability: string; calls: number }[];
  planChecks: CmoPlanChecks;
}

/** What the save-time review of Cuso's plans found, from save_strategy results. */
export interface CmoPlanChecks {
  /** Saves the review ran on. */
  checked: number;
  /** Saves that came back with problems for Cuso to fix. */
  withProblems: number;
  /** Saves where the evaluator said the plan drifted from the main offer. */
  drifted: number;
  /** Saves where the evaluator could not answer. */
  unavailable: number;
  /** The newest save that had problems, and what they were. */
  last: { at: string; problems: string[] } | null;
}

interface SavedReview {
  mainOffer?: string;
  problems?: unknown;
}

export function planChecks(
  saves: { createdAt: Date; result: unknown }[],
): CmoPlanChecks {
  const checks: CmoPlanChecks = {
    checked: 0,
    withProblems: 0,
    drifted: 0,
    unavailable: 0,
    last: null,
  };
  for (const save of saves) {
    const review = (save.result as { review?: SavedReview } | null)?.review;
    if (!review) continue;
    const problems = Array.isArray(review.problems)
      ? review.problems.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    checks.checked += 1;
    if (review.mainOffer === "drift") checks.drifted += 1;
    if (review.mainOffer === "unavailable") checks.unavailable += 1;
    if (problems.length === 0) continue;
    checks.withProblems += 1;
    checks.last ??= { at: save.createdAt.toISOString(), problems };
  }
  return checks;
}

const MICROS = 1_000_000;

function number(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * What each CMO bot spent since a date and where it went: per model and per
 * paid search, per tool, plus images and the overhead of routing and judging.
 * Read from the turns' own spend split, the tool-call log, image jobs and the
 * credit ledger, so it matches what owners were charged.
 */
export async function cmoSpend(since: Date): Promise<CmoSpend[]> {
  const hires = await prisma.cmoHire.findMany({
    select: {
      sokoBotId: true,
      projectId: true,
      businessName: true,
      // Cuso is the business's shared bot; his hirer stands for it here.
      sokoBot: { select: { createdByUserId: true } },
    },
  });
  if (hires.length === 0) return [];
  const bots = hires.map((hire) => hire.sokoBotId);
  const projects = hires.map((hire) => hire.projectId);

  const [owners, turns, sources, tools, images, charged, saves] =
    await Promise.all([
      prisma.user.findMany({
        where: {
          id: {
            in: hires.flatMap((hire) => hire.sokoBot.createdByUserId ?? []),
          },
        },
        select: { id: true, email: true },
      }),
      prisma.$queryRaw<
        { sokoBotId: string; turns: bigint; overhead: bigint | null }[]
      >`
      SELECT "sokoBotId", COUNT(*) AS turns,
        SUM("overheadCostUsdMicros") AS overhead
      FROM soko_bot_turn
      WHERE "sokoBotId" = ANY(${bots}::uuid[]) AND "createdAt" >= ${since}
      GROUP BY "sokoBotId"`,
      // Each turn keeps its spend split by source. Older turns only know their
      // total and their model, so they count under that model.
      prisma.$queryRaw<
        {
          sokoBotId: string;
          source: string | null;
          cost: number | null;
          calls: number | null;
          input: number | null;
          output: number | null;
        }[]
      >`
      SELECT t."sokoBotId", s.key AS source,
        SUM((s.value->>'costUsd')::float8) AS cost,
        SUM((s.value->>'calls')::float8) AS calls,
        SUM((s.value->>'inputTokens')::float8) AS input,
        SUM((s.value->>'outputTokens')::float8) AS output
      FROM soko_bot_turn t
      CROSS JOIN LATERAL jsonb_each(t.usage->'bySource') s
      WHERE t."sokoBotId" = ANY(${bots}::uuid[]) AND t."createdAt" >= ${since}
        AND jsonb_typeof(t.usage->'bySource') = 'object'
      GROUP BY t."sokoBotId", s.key
      UNION ALL
      SELECT t."sokoBotId", COALESCE(t."modelId", 'unknown') AS source,
        SUM(COALESCE(t."costUsdMicros", 0))::float8 / 1000000 AS cost,
        COUNT(*)::float8 AS calls,
        SUM(CASE WHEN jsonb_typeof(t.usage->'inputTokens') = 'number'
          THEN (t.usage->>'inputTokens')::float8 ELSE 0 END) AS input,
        SUM(CASE WHEN jsonb_typeof(t.usage->'outputTokens') = 'number'
          THEN (t.usage->>'outputTokens')::float8 ELSE 0 END) AS output
      FROM soko_bot_turn t
      WHERE t."sokoBotId" = ANY(${bots}::uuid[]) AND t."createdAt" >= ${since}
        AND jsonb_typeof(t.usage->'bySource') IS DISTINCT FROM 'object'
        AND COALESCE(t."costUsdMicros", 0) > 0
      GROUP BY t."sokoBotId", COALESCE(t."modelId", 'unknown')`,
      prisma.$queryRaw<
        { sokoBotId: string; capability: string; calls: bigint }[]
      >`
      SELECT t."sokoBotId", c.capability, COUNT(*) AS calls
      FROM soko_bot_tool_call c
      JOIN soko_bot_turn t ON t.id = c."turnId"
      WHERE t."sokoBotId" = ANY(${bots}::uuid[]) AND c."createdAt" >= ${since}
      GROUP BY t."sokoBotId", c.capability`,
      // A quote only counts once it was charged, in the period it was charged.
      prisma.$queryRaw<{ projectId: string; cents: bigint | null }[]>`
      SELECT j."projectId", SUM(COALESCE(j."chargedCents", 0)) AS cents
      FROM project_image_job j
      JOIN "Transaction" t ON t.id = j."transactionId"
      WHERE j."projectId" = ANY(${projects}::uuid[]) AND t."createdAt" >= ${since}
      GROUP BY j."projectId"`,
      prisma.$queryRaw<{ sokoBotId: string; cents: bigint | null }[]>`
      SELECT "sokoBotId", SUM(cents) AS cents
      FROM soko_bot_usage
      WHERE "sokoBotId" = ANY(${bots}::uuid[]) AND "createdAt" >= ${since}
      GROUP BY "sokoBotId"`,
      // Newest first, so the first save with problems is the latest.
      prisma.sokoBotToolCall.findMany({
        where: {
          capability: "save_strategy",
          createdAt: { gte: since },
          turn: { sokoBotId: { in: bots } },
        },
        select: {
          createdAt: true,
          result: true,
          turn: { select: { sokoBotId: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  return hires
    .map((hire) => {
      const turn = turns.find((row) => row.sokoBotId === hire.sokoBotId);
      // Both halves of the union can name the same model.
      const merged = new Map<string, CmoSpendLine>();
      for (const row of sources) {
        if (row.sokoBotId !== hire.sokoBotId) continue;
        const source = row.source ?? "unknown";
        const line = merged.get(source) ?? {
          source,
          costUsd: 0,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        line.costUsd += number(row.cost);
        line.calls += number(row.calls);
        line.inputTokens += number(row.input);
        line.outputTokens += number(row.output);
        merged.set(source, line);
      }
      const bySource = [...merged.values()].sort(
        (a, b) => b.costUsd - a.costUsd,
      );
      const overheadUsd = number(turn?.overhead) / MICROS;
      const imagesCredits = convertCentsToCredits(
        images.find((row) => row.projectId === hire.projectId)?.cents ?? 0n,
      );
      return {
        sokoBotId: hire.sokoBotId,
        businessName: hire.businessName,
        ownerEmail:
          owners.find((owner) => owner.id === hire.sokoBot.createdByUserId)
            ?.email ?? "",
        turns: number(turn?.turns),
        totalUsd:
          bySource.reduce((sum, line) => sum + line.costUsd, 0) + overheadUsd,
        overheadUsd,
        imagesCredits,
        chargedCredits:
          convertCentsToCredits(
            charged.find((row) => row.sokoBotId === hire.sokoBotId)?.cents ??
              0n,
          ) + imagesCredits,
        bySource,
        tools: tools
          .filter((row) => row.sokoBotId === hire.sokoBotId)
          .map((row) => ({
            capability: row.capability,
            calls: number(row.calls),
          }))
          .sort((a, b) => b.calls - a.calls),
        planChecks: planChecks(
          saves.filter((save) => save.turn.sokoBotId === hire.sokoBotId),
        ),
      };
    })
    .sort((a, b) => b.totalUsd - a.totalUsd);
}
