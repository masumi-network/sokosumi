import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import {
  SEO_IMPACT_FINAL_STATES,
  type SeoImpactResult,
  seoImpactInputSchema,
} from "@/schemas/seo-impact-worker.schema";

/** A claim ends this long after it starts, and another claim can take the change. Not calibrated. */
export const SEO_IMPACT_CLAIM_MS = 30 * 60_000;
/** Claims of one change: after the last one ends without a verdict, the change ends. Not calibrated. */
export const SEO_IMPACT_MAX_CLAIMS = 3;
/** Rows tried when concurrent claims take the oldest first. */
const CLAIM_RACE_ATTEMPTS = 5;

const unclaimed = (now: Date): Prisma.ProjectSeoImpactVerdictWhereInput => ({
  state: "ready",
  OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }],
});
const claimable = (now: Date): Prisma.ProjectSeoImpactVerdictWhereInput => ({
  ...unclaimed(now),
  attempts: { lt: SEO_IMPACT_MAX_CLAIMS },
});

/**
 * Gives the worker the oldest ready change for a time. A claim that ends
 * without a verdict lets a later claim take the change. Its claimId keeps
 * working until then.
 */
export async function claimSeoImpact(now: Date = new Date()) {
  const env = getEnv();
  if (!env.SEO_IMPACT_TRACKING_ENABLED || !env.SEO_IMPACT_DISPATCH_ENABLED)
    return null;
  await prisma.projectSeoImpactVerdict.updateMany({
    where: { ...unclaimed(now), attempts: { gte: SEO_IMPACT_MAX_CLAIMS } },
    data: { state: "not_measurable", reason: "worker_failed" },
  });
  for (let attempt = 0; attempt < CLAIM_RACE_ATTEMPTS; attempt += 1) {
    const row = await prisma.projectSeoImpactVerdict.findFirst({
      where: claimable(now),
      orderBy: [{ windowEnd: "asc" }, { id: "asc" }],
      select: { id: true, attempts: true, input: true, updatedAt: true },
    });
    if (!row) return null;
    const parsed = seoImpactInputSchema.safeParse(row.input);
    if (!parsed.success) {
      // Stored under older rules: the next tick prepares it again, and the
      // queue serves the other changes meanwhile. updatedAt keeps an input
      // prepared since this read, and the ended claim's verdict gets 404.
      await prisma.projectSeoImpactVerdict.updateMany({
        where: { id: row.id, state: "ready", updatedAt: row.updatedAt },
        data: {
          state: "waiting_window",
          input: Prisma.DbNull,
          claimId: null,
          claimedUntil: null,
          // The claims of the old input count nothing against the new one.
          attempts: 0,
        },
      });
      continue;
    }
    const input = parsed.data;
    const claimId = randomUUID();
    const claimedUntil = new Date(now.getTime() + SEO_IMPACT_CLAIM_MS);
    // The attempts this read saw: of two claims at once, one wins the row.
    // updatedAt: an input prepared again since this read is not served.
    const { count } = await prisma.projectSeoImpactVerdict.updateMany({
      where: {
        id: row.id,
        attempts: row.attempts,
        updatedAt: row.updatedAt,
        ...claimable(now),
      },
      data: { claimId, claimedUntil, attempts: { increment: 1 } },
    });
    if (count)
      return { claimId, claimedUntil: claimedUntil.toISOString(), input };
  }
  return null;
}

const isFinal = (state: SeoImpactResult["state"]) =>
  (SEO_IMPACT_FINAL_STATES as readonly string[]).includes(state);

/**
 * Saves the worker's result for its claim. The same result again gets the
 * same answer, so a worker can retry a post whose reply it lost.
 */
export async function recordSeoImpactVerdict(
  claimId: string,
  result: SeoImpactResult,
  now: Date = new Date(),
) {
  const row = await prisma.projectSeoImpactVerdict.findUnique({
    where: { claimId },
    select: { id: true, state: true, input: true, verdict: true },
  });
  if (!row) throw notFound("No claim has this id. A newer claim took it.");
  const receipt = { impactId: row.id, state: result.state };
  const verdict = jsonInput(result);
  const saved = isFinal(result.state) ? "measured" : "waiting_retry";
  // A replay of the result this claim saved gets its answer, also when the
  // input rules changed since. A change prepared again, or ended, keeps the
  // result of its waiting input: that one is no replay.
  if (row.state === saved && isDeepStrictEqual(row.verdict, verdict))
    return receipt;
  const parsed = seoImpactInputSchema.safeParse(row.input);
  // Stored under older rules: the next claim sends the change back to be prepared.
  if (!parsed.success)
    throw conflict("The change's input changed: claim it again");
  const input = parsed.data;
  if (
    result.impactId !== row.id ||
    result.pageUrl !== input.pageUrl ||
    result.property !== input.property ||
    result.changedAt !== input.changedAt ||
    result.changeSource !== input.changeSource ||
    result.windowCrawl !== input.windowCrawl ||
    result.observedAt !== input.readAt
  )
    throw unprocessableEntity("The result answers another input");
  const { count } = await prisma.projectSeoImpactVerdict.updateMany({
    where: { id: row.id, claimId, state: "ready" },
    data: isFinal(result.state)
      ? { state: "measured", verdict, verdictAt: now, claimedUntil: null }
      : {
          state: "waiting_retry",
          verdict,
          waits: { increment: 1 },
          claimedUntil: null,
        },
  });
  if (count) return receipt;
  const stored = await prisma.projectSeoImpactVerdict.findUnique({
    where: { id: row.id },
    select: { claimId: true, verdict: true },
  });
  if (stored?.claimId === claimId && isDeepStrictEqual(stored.verdict, verdict))
    return receipt;
  throw conflict("The claim ended, or the change has another result");
}
