import type { Prisma } from "@sokosumi/database";

import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { instagramHandle } from "@/lib/competitors/instagram";
import prisma from "@/lib/db/prisma";

/**
 * The competitors a Project watches: the list members keep, and whether the
 * weekly check is on. Any Project can watch competitors; CMO fills a Cuso's
 * list from his Brand Brain on top (`cmo-competitors.service`).
 */

/** How many competitors a Project watches at once. */
export const MAX_TRACKED_COMPETITORS = 5;

export const TRACKED_COMPETITOR_SELECT = {
  id: true,
  memberEditedAt: true,
  createdAt: true,
  projectId: true,
  name: true,
  websiteUrl: true,
  pricingUrl: true,
  instagramHandle: true,
  facebookHandle: true,
  source: true,
} as const satisfies Prisma.TrackedCompetitorSelect;

export type TrackedCompetitorRow = Prisma.TrackedCompetitorGetPayload<{
  select: typeof TRACKED_COMPETITOR_SELECT;
}>;

/** One row per competitor, however its name is spelled: "Cal.com" and "cal com". */
export function competitorNameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The competitors a Project watches now, in the order they were added. */
export function listTrackedCompetitors(
  projectId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<TrackedCompetitorRow[]> {
  return db.trackedCompetitor.findMany({
    where: { projectId, removedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: TRACKED_COMPETITOR_SELECT,
  });
}

/**
 * Holds the Project's competitor list while a write checks and changes it,
 * so two writes never take the list past the cap or share a name.
 */
async function lockCompetitors(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${projectId}::uuid FOR NO KEY UPDATE`;
}

/** A write that lost a name race to another: the same answer as the check. */
export async function inLockedCompetitorList(
  projectId: string,
  write: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await lockCompetitors(tx, projectId);
      await write(tx);
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error))
      throw conflict("You already track this competitor");
    throw error;
  }
}

/** What a member may set on a competitor; null clears a field. */
export interface TrackedCompetitorInput {
  name?: string;
  websiteUrl?: string | null;
  pricingUrl?: string | null;
  instagramHandle?: string | null;
  facebookHandle?: string | null;
}

function webAddress(value: string | null | undefined, field: string) {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  const url = URL.parse(
    /^https?:\/\//i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`,
  );
  if (!url || !url.hostname.includes("."))
    throw unprocessableEntity(`${field} is not a web address`);
  return url.href;
}

/** "@Acme", a facebook.com address or a bare Page name, as the handle. */
export function facebookHandle(value: string): string | null {
  const trimmed = value.trim();
  const fromUrl = /(?:facebook|fb)\.com\/([^/?#]+)/i.exec(trimmed)?.[1];
  const handle = (fromUrl ?? trimmed).replace(/^@/, "");
  return /^[a-z0-9.-]{2,80}$/i.test(handle) ? handle.toLowerCase() : null;
}

function handle(
  value: string | null | undefined,
  read: (value: string) => string | null,
  network: string,
) {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  const parsed = read(value);
  if (!parsed) throw unprocessableEntity(`That is not ${network} account`);
  return parsed;
}

function memberFields(input: TrackedCompetitorInput) {
  return {
    websiteUrl: webAddress(input.websiteUrl, "The website"),
    pricingUrl: webAddress(input.pricingUrl, "The pricing page"),
    instagramHandle: handle(
      input.instagramHandle,
      instagramHandle,
      "an Instagram",
    ),
    facebookHandle: handle(input.facebookHandle, facebookHandle, "a Facebook"),
  };
}

/** The row holding a name: refused while tracked, returned when removed. */
async function requireFreeName(
  tx: Prisma.TransactionClient,
  projectId: string,
  nameKey: string,
): Promise<{ id: string } | null> {
  const taken = await tx.trackedCompetitor.findUnique({
    where: { projectId_nameKey: { projectId, nameKey } },
    select: { id: true, removedAt: true },
  });
  if (taken && !taken.removedAt)
    throw conflict("You already track this competitor");
  return taken;
}

/**
 * A member adds a competitor. One the member removed before comes back as
 * the same row, so its earlier signals stay with it. One picked from the
 * suggestions (`suggested`) keeps its empty fields open for the weekly check
 * to fill from its homepage.
 */
export async function addTrackedCompetitor(
  projectId: string,
  input: TrackedCompetitorInput & { name: string; suggested?: boolean },
): Promise<void> {
  const name = input.name.trim();
  const nameKey = competitorNameKey(name);
  if (!nameKey) throw unprocessableEntity("Give the competitor a name");
  const fields = memberFields(input);
  await inLockedCompetitorList(projectId, async (tx) => {
    const live = await tx.trackedCompetitor.count({
      where: { projectId, removedAt: null },
    });
    if (live >= MAX_TRACKED_COMPETITORS)
      throw conflict(
        `You can track ${MAX_TRACKED_COMPETITORS} competitors. Remove one first.`,
      );
    const removed = await requireFreeName(tx, projectId, nameKey);
    const data = {
      name,
      ...fields,
      // A picked suggestion is nobody's typing: the check may still fill it.
      memberEditedAt: input.suggested ? null : new Date(),
      removedAt: null,
    };
    if (removed)
      await tx.trackedCompetitor.update({ where: { id: removed.id }, data });
    else
      await tx.trackedCompetitor.create({
        data: { projectId, nameKey, source: "MEMBER", ...data },
      });
  });
}

async function requireTracked(
  tx: Prisma.TransactionClient,
  projectId: string,
  id: string,
) {
  const competitor = await tx.trackedCompetitor.findFirst({
    where: { id, projectId, removedAt: null },
    select: { id: true, nameKey: true },
  });
  if (!competitor) throw notFound("Competitor not found");
  return competitor;
}

/** A member changes a competitor; from then on research leaves it alone. */
export async function updateTrackedCompetitor(
  projectId: string,
  id: string,
  input: TrackedCompetitorInput,
): Promise<void> {
  const name = input.name?.trim();
  const nameKey = name === undefined ? undefined : competitorNameKey(name);
  if (nameKey === "") throw unprocessableEntity("Give the competitor a name");
  const fields = memberFields(input);
  await inLockedCompetitorList(projectId, async (tx) => {
    const competitor = await requireTracked(tx, projectId, id);
    if (nameKey && nameKey !== competitor.nameKey) {
      const removed = await requireFreeName(tx, projectId, nameKey);
      // A removed row gives up the name and keeps its signals.
      if (removed)
        await tx.trackedCompetitor.update({
          where: { id: removed.id },
          data: { nameKey: `${nameKey}~${removed.id}` },
        });
    }
    await tx.trackedCompetitor.update({
      where: { id },
      data: {
        ...(name && nameKey ? { name, nameKey } : {}),
        ...fields,
        memberEditedAt: new Date(),
      },
    });
  });
}

/** A member stops tracking a competitor; research does not add it back. */
export async function removeTrackedCompetitor(
  projectId: string,
  id: string,
): Promise<void> {
  await inLockedCompetitorList(projectId, async (tx) => {
    await requireTracked(tx, projectId, id);
    const now = new Date();
    await tx.trackedCompetitor.update({
      where: { id },
      data: { removedAt: now, memberEditedAt: now },
    });
  });
}

/**
 * Whether a bot may be offered the competitor tools: its own Project's
 * weekly check is on, or, for a bot that works across Projects, the check
 * of any open Project in its workspace.
 */
export async function competitorChecksOnFor(bot: {
  projectId: string | null;
  workspaceId: string;
}): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: {
      ...(bot.projectId ? { id: bot.projectId } : {}),
      workspaceId: bot.workspaceId,
      closedAt: null,
      competitorChecksSince: { not: null },
    },
    select: { id: true },
  });
  return project !== null;
}

/**
 * A member turns the weekly check on or off for a Project. On keeps the day
 * it was first turned on; off stops the checks and keeps what they found.
 */
export async function setCompetitorChecks(
  projectId: string,
  on: boolean,
): Promise<void> {
  if (!on) {
    await prisma.project.update({
      where: { id: projectId },
      data: { competitorChecksSince: null },
    });
    return;
  }
  await prisma.project.updateMany({
    where: { id: projectId, competitorChecksSince: null },
    data: { competitorChecksSince: new Date() },
  });
}
