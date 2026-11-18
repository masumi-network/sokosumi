import type { Prisma } from "@sokosumi/database";

import { unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { instagramHandle } from "@/lib/competitors/instagram";
import prisma from "@/lib/db/prisma";
import { parseBrandBrain } from "@/services/brand-brain.service";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";

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

function homepage(url: string | undefined): string | null {
  const parsed = url ? URL.parse(url) : null;
  return parsed && (parsed.protocol === "https:" || parsed.protocol === "http:")
    ? new URL("/", parsed).href
    : null;
}

/**
 * The competitors Brand Brain research names, the market map's players
 * first (the ones the owner sees on the map), each once.
 */
export function researchedCompetitors(
  body: unknown,
): { name: string; websiteUrl: string | null }[] {
  const brain = parseBrandBrain(body);
  if (!brain) return [];
  const listed = new Map(
    brain.competitors.map((competitor) => [
      competitorNameKey(competitor.name),
      competitor,
    ]),
  );
  const players = (brain.reveal?.map?.players ?? [])
    .filter((player) => !player.you)
    .map((player) => {
      const key = competitorNameKey(player.name);
      const match = listed.get(key);
      // The map's spelling: the one the owner sees.
      return {
        key,
        name: player.name,
        websiteUrl: homepage(match?.url),
      };
    });
  const rest = brain.competitors.map((competitor) => ({
    key: competitorNameKey(competitor.name),
    name: competitor.name,
    websiteUrl: homepage(competitor.url),
  }));
  const seen = new Set<string>();
  return [...players, ...rest].flatMap(({ key, ...competitor }) => {
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [competitor];
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
async function inLockedList(
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
      throw new CmoConflictError("You already track this competitor");
    throw error;
  }
}

/**
 * Fills a Project's tracked competitors from its Brand Brain, up to the cap.
 * Research only adds, and only fills a website it left empty before: a
 * competitor a member changed, renamed or removed stays as the member left
 * it, and research knows it by the name it found (`researchKey`).
 */
export async function syncTrackedCompetitorsFromBrandBrain(
  projectId: string,
): Promise<void> {
  const brandBrain = await prisma.brandBrain.findUnique({
    where: { projectId },
    select: { body: true },
  });
  const researched = researchedCompetitors(brandBrain?.body);
  if (researched.length === 0) return;
  await inLockedList(projectId, async (tx) => {
    const existing = await tx.trackedCompetitor.findMany({
      where: { projectId },
      select: {
        id: true,
        nameKey: true,
        researchKey: true,
        websiteUrl: true,
        memberEditedAt: true,
        removedAt: true,
      },
    });
    const byKey = new Map(
      existing.flatMap((row) => [
        [row.nameKey, row] as const,
        ...(row.researchKey ? [[row.researchKey, row] as const] : []),
      ]),
    );
    let free =
      MAX_TRACKED_COMPETITORS - existing.filter((row) => !row.removedAt).length;
    const add: Prisma.TrackedCompetitorCreateManyInput[] = [];
    for (const competitor of researched) {
      const nameKey = competitorNameKey(competitor.name);
      const row = byKey.get(nameKey);
      if (row) {
        if (
          !row.removedAt &&
          !row.memberEditedAt &&
          !row.websiteUrl &&
          competitor.websiteUrl
        )
          await tx.trackedCompetitor.update({
            where: { id: row.id },
            data: { websiteUrl: competitor.websiteUrl },
          });
        continue;
      }
      if (free <= 0) continue;
      free -= 1;
      add.push({
        projectId,
        name: competitor.name,
        nameKey,
        researchKey: nameKey,
        websiteUrl: competitor.websiteUrl,
        source: "RESEARCH",
      });
    }
    if (add.length > 0) await tx.trackedCompetitor.createMany({ data: add });
  });
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
    throw new CmoConflictError("You already track this competitor");
  return taken;
}

/**
 * A member adds a competitor. One the member removed before comes back as
 * the same row, so its earlier signals stay with it.
 */
export async function addTrackedCompetitor(
  target: CusoTarget,
  input: TrackedCompetitorInput & { name: string },
): Promise<void> {
  const { projectId } = await requireCuso(target);
  const name = input.name.trim();
  const nameKey = competitorNameKey(name);
  if (!nameKey) throw unprocessableEntity("Give the competitor a name");
  const fields = memberFields(input);
  await inLockedList(projectId, async (tx) => {
    const live = await tx.trackedCompetitor.count({
      where: { projectId, removedAt: null },
    });
    if (live >= MAX_TRACKED_COMPETITORS)
      throw new CmoConflictError(
        `You can track ${MAX_TRACKED_COMPETITORS} competitors. Remove one first.`,
      );
    const removed = await requireFreeName(tx, projectId, nameKey);
    const data = {
      name,
      ...fields,
      memberEditedAt: new Date(),
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
  if (!competitor) throw new CmoNotFoundError("Competitor not found");
  return competitor;
}

/** A member changes a competitor; from then on research leaves it alone. */
export async function updateTrackedCompetitor(
  target: CusoTarget,
  id: string,
  input: TrackedCompetitorInput,
): Promise<void> {
  const { projectId } = await requireCuso(target);
  const name = input.name?.trim();
  const nameKey = name === undefined ? undefined : competitorNameKey(name);
  if (nameKey === "") throw unprocessableEntity("Give the competitor a name");
  const fields = memberFields(input);
  await inLockedList(projectId, async (tx) => {
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
  target: CusoTarget,
  id: string,
): Promise<void> {
  const { projectId } = await requireCuso(target);
  await inLockedList(projectId, async (tx) => {
    await requireTracked(tx, projectId, id);
    const now = new Date();
    await tx.trackedCompetitor.update({
      where: { id },
      data: { removedAt: now, memberEditedAt: now },
    });
  });
}
