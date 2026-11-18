import { randomUUID } from "node:crypto";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";

/** For competitor tests on a real PostgreSQL (`*.postgres.test.ts`). */
const CREDIT = 10_000_000_000n;
const DAY = 86_400_000;

export interface SeededProject {
  userId: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
}

export interface Seeded extends SeededProject {
  sokoBotId: string;
}

const seeded: (SeededProject & { sokoBotId?: string })[] = [];

export function company(name: string, url?: string) {
  return { name, ...(url ? { url } : {}) };
}

export function brain(
  competitors: { name: string; url?: string }[],
  players: string[] = [],
) {
  return {
    summary: "Scheduling for small teams.",
    voice: { tone: "Plain.", do: [], dont: [], examples: [] },
    audience: [],
    products: [],
    competitors,
    channels: [],
    ...(players.length > 0
      ? {
          reveal: {
            positioning: "Scheduling that stays out of the way",
            insights: [],
            buyers: [],
            map: {
              x: { low: "Simple", high: "Powerful" },
              y: { low: "Cheap", high: "Premium" },
              players: [
                { name: "Acme", x: 50, y: 50, you: true },
                ...players.map((name, index) => ({
                  name,
                  x: 10 * index,
                  y: 10 * index,
                })),
              ],
            },
          },
        }
      : {}),
  };
}

async function seedOrganizationProject(): Promise<SeededProject> {
  const suffix = randomUUID().slice(0, 8);
  const userId = `competitors-user-${suffix}`;
  const organizationId = `competitors-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Competitors Owner",
      email: `competitors-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Competitors Org",
      slug: organizationId,
      members: { create: { userId, role: "owner" } },
    },
  });
  const workspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId,
    tx: prisma,
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "acme.io",
      websiteUrl: "https://www.acme.io",
    },
    select: { id: true },
  });
  const row = {
    userId,
    organizationId,
    workspaceId: workspace.id,
    projectId: project.id,
  };
  seeded.push(row);
  return row;
}

async function grantCredits(
  organizationId: string,
  credits: bigint,
  projectId?: string,
): Promise<void> {
  if (credits <= 0n) return;
  const amount = credits * CREDIT;
  await prisma.transaction.create({
    data: {
      amount,
      organizationId,
      sourceCreditBucket: {
        create: { amount, organizationId, ...(projectId ? { projectId } : {}) },
      },
    },
  });
}

/** A Project without a Cuso, in an organization with credits in its pool. */
export async function seedProject(credits = 100n): Promise<SeededProject> {
  const row = await seedOrganizationProject();
  await grantCredits(row.organizationId, credits);
  return row;
}

/** A subscribed Cuso with an approved strategy and Project credits. */
export async function seedCuso(credits = 100n): Promise<Seeded> {
  const base = await seedOrganizationProject();
  const { userId, organizationId, workspaceId } = base;
  const project = { id: base.projectId };
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId,
      projectId: project.id,
      userId: null,
      createdByUserId: userId,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  await prisma.marketingStrategy.create({
    data: { projectId: project.id, plan: {}, approvedAt: new Date() },
  });
  const now = new Date();
  await prisma.polarSubscription.create({
    data: {
      kind: "CMO",
      projectId: project.id,
      organizationId,
      polarSubscriptionId: `sub_${randomUUID()}`,
      polarProductId: "prod_starter",
      tier: "starter",
      interval: "month",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
      cancelAtPeriodEnd: false,
      endedAt: null,
      polarEventAt: now,
    },
  });
  await grantCredits(organizationId, credits, project.id);
  const row = seeded.find((entry) => entry.projectId === project.id);
  if (row) row.sokoBotId = bot.id;
  return { ...base, sokoBotId: bot.id };
}

/** Deletes every Project and Cuso seeded here, with what hangs off them. */
export async function deleteSeededCusos(): Promise<void> {
  for (const cuso of seeded.splice(0)) {
    await prisma.project.delete({ where: { id: cuso.projectId } });
    if (cuso.sokoBotId) {
      await prisma.sokoBotUsage.deleteMany({
        where: { sokoBotId: cuso.sokoBotId },
      });
      await prisma.sokoBot.deleteMany({ where: { id: cuso.sokoBotId } });
    }
    await prisma.creditConsumption.deleteMany({
      where: { transaction: { organizationId: cuso.organizationId } },
    });
    await prisma.transaction.deleteMany({
      where: { organizationId: cuso.organizationId },
    });
    await prisma.creditBucket.deleteMany({
      where: { organizationId: cuso.organizationId },
    });
    await prisma.polarSubscription.deleteMany({
      where: { organizationId: cuso.organizationId },
    });
    await prisma.workspace.deleteMany({
      where: { organizationId: cuso.organizationId },
    });
    await prisma.organization.delete({ where: { id: cuso.organizationId } });
    await prisma.user.delete({ where: { id: cuso.userId } });
  }
}
