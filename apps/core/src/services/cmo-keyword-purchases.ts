// The CMO subscription owns these receipts. They do not settle a full SEO audit Task.
import { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import prisma from "@/lib/db/prisma";
import { CmoConflictError } from "./cmo-cuso.service";

export const CMO_KEYWORD_SEARCHES_PER_DAY = 25;
const UTC_DAY_MS = 86_400_000;
const OVERNIGHT_IN_FLIGHT_MS = 5 * 60_000; // One suggestions POST, two parallel model calls and receipt writes.
const CACHE = "keyword_ideas";
const RUN = "keyword_research_run";
const CHARGE = "keyword_research_charge";
const sameDay = (now: Date) =>
  new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");

export async function keywordSearchesLeft(
  projectId: string,
  now: Date = new Date(),
  db: Prisma.TransactionClient = prisma,
) {
  const recent = await db.projectSeoResearch.findMany({
    where: {
      projectId,
      kind: { in: [CACHE, RUN] },
      observedAt: { gte: sameDay(now) },
    },
    select: { key: true, kind: true },
  });
  return Math.max(
    0,
    CMO_KEYWORD_SEARCHES_PER_DAY -
      new Set(
        recent.map((row) =>
          row.kind === RUN ? row.key.slice(row.key.indexOf("|") + 1) : row.key,
        ),
      ).size,
  );
}

/** Hold the project lock only for admission. All network calls run after this transaction. */
export async function reserveKeywordRun(
  projectId: string,
  key: string,
  now: Date,
  maxAge: number,
  usable: (payload: unknown) => boolean,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM ${sharedTable("project")} WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    const find = (kind: string, k: string) =>
      tx.projectSeoResearch.findUnique({
        where: { projectId_kind_key: { projectId, kind, key: k } },
        select: { payload: true, observedAt: true },
      });
    const cached = await find(CACHE, key);
    if (
      cached &&
      now >= cached.observedAt &&
      now.getTime() - cached.observedAt.getTime() < maxAge &&
      usable(cached.payload)
    )
      return { cached } as const;
    const runKey = now.toISOString().slice(0, 10) + "|" + key;
    // The prior UTC day may still have a live purchase when the daily quota turns over.
    const previousDay = new Date(now.getTime() - UTC_DAY_MS)
      .toISOString()
      .slice(0, 10);
    const previous = await find(RUN, previousDay + "|" + key);
    const recentPrevious =
      previous &&
      now.getTime() - previous.observedAt.getTime() < OVERNIGHT_IN_FLIGHT_MS;
    if (recentPrevious || (await find(RUN, runKey)))
      throw new CmoConflictError(
        "This keyword search was already started today. Check the SEO tab for its result.",
      );
    if (!(await keywordSearchesLeft(projectId, now, tx)))
      throw new CmoConflictError(
        `That was today's last keyword search (${CMO_KEYWORD_SEARCHES_PER_DAY} a day). Try again tomorrow.`,
      );
    const run = await tx.projectSeoResearch.create({
      data: {
        projectId,
        key: runKey,
        kind: RUN,
        observedAt: now,
        payload: { status: "running", totalUsd: null },
      },
      select: { id: true },
    });
    return { runId: run.id, previous: cached } as const;
  });
}

export async function beginKeywordCharge(
  projectId: string,
  runId: string,
  source: string,
  now: Date,
) {
  return prisma.projectSeoResearch.create({
    data: {
      projectId,
      kind: CHARGE,
      key: runId + "|" + source,
      observedAt: now,
      payload: { source, status: "pending", costUsd: null },
    },
    select: { id: true },
  });
}

export async function closeKeywordCharge(
  id: string,
  source: string,
  status: "ok" | "failed",
  costUsd: number | null,
  reference: string | null,
) {
  await prisma.projectSeoResearch.update({
    where: { id },
    data: { payload: { source, status, costUsd, reference } },
  });
}

/** Add the persisted component receipts, including billed attempts whose output could not be used. */
export async function keywordRunTotals(projectId: string, runId: string) {
  const lines = await prisma.projectSeoResearch.findMany({
    where: { projectId, kind: CHARGE, key: { startsWith: runId + "|" } },
    select: { payload: true },
  });
  let known = new Prisma.Decimal(0);
  let complete = lines.length > 0;
  for (const { payload } of lines) {
    const price =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.costUsd
        : null;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0)
      complete = false;
    else known = known.plus(price);
  }
  return {
    knownUsd: known.toNumber(),
    totalUsd: complete ? known.toNumber() : null,
  };
}
