/**
 * Real-Postgres proof that archiving a Cuso cancels his Project's posts that
 * have not gone out, so an archived Cuso never keeps publishing: the
 * publisher holds posts only for a Project with a live Cuso.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/soko-bot-archive.postgres.test.ts
 *
 * Fixtures are committed and deleted after each test.
 */
import { randomUUID } from "node:crypto";
import type { SocialPostStatus } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const workspaces: string[] = [];
const organizations: string[] = [];
const users: string[] = [];

async function seedOrganization() {
  const ownerId = `archive-user-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({
    data: {
      id: ownerId,
      name: "Owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  users.push(ownerId);
  const organizationId = `archive-org-${randomUUID().slice(0, 8)}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Archive Org",
      slug: organizationId,
      members: { create: { userId: ownerId, role: "owner" } },
    },
  });
  organizations.push(organizationId);
  const { id: workspaceId } = await prisma.workspace.create({
    data: { organizationId },
    select: { id: true },
  });
  workspaces.push(workspaceId);
  return { ownerId, workspaceId };
}

/** A shared bot of a Project: Cuso on CMO's version, any other bot on none. */
async function seedSharedBot(
  org: { ownerId: string; workspaceId: string },
  versionId: string | null,
) {
  const project = await prisma.project.create({
    data: { workspaceId: org.workspaceId, name: "acme.io" },
    select: { id: true },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId: org.workspaceId,
      projectId: project.id,
      userId: null,
      createdByUserId: org.ownerId,
      versionId,
      name: "Bot",
    },
    select: { id: true },
  });
  return { projectId: project.id, sokoBotId: bot.id };
}

/** One post per status; the scheduled one is due, so it would publish now. */
async function seedPosts(
  org: { ownerId: string; workspaceId: string },
  projectId: string,
  sokoBotId: string,
) {
  const statuses: SocialPostStatus[] = [
    "DRAFT",
    "NEEDS_APPROVAL",
    "SCHEDULED",
    "FAILED",
    "PUBLISHED",
  ];
  for (const status of statuses) {
    await prisma.socialPost.create({
      data: {
        projectId,
        workspaceId: org.workspaceId,
        provider: "x",
        text: `A ${status} post`,
        status,
        scheduledAt: new Date(Date.now() - 60_000),
        // The owner's own post goes too: the Project, not its maker, decides.
        ...(status === "SCHEDULED"
          ? { creatorUserId: org.ownerId }
          : { creatorSokoBotId: sokoBotId }),
      },
    });
  }
}

async function statusesOf(projectId: string) {
  const posts = await prisma.socialPost.findMany({
    where: { projectId },
    select: { text: true, status: true },
    orderBy: { text: "asc" },
  });
  return Object.fromEntries(posts.map((post) => [post.text, post.status]));
}

describe.skipIf(!enabled)("archiving a Soko Bot against PostgreSQL", () => {
  afterEach(async () => {
    for (const workspaceId of workspaces.splice(0)) {
      await prisma.socialPost.deleteMany({ where: { workspaceId } });
      await prisma.sokoBot.deleteMany({ where: { workspaceId } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await prisma.organization.deleteMany({
      where: { id: { in: organizations.splice(0) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });

  it("cancels a Cuso's unsent posts, and leaves failed and published ones", async () => {
    const org = await seedOrganization();
    const cuso = await seedSharedBot(org, CMO_SOKO_BOT_VERSION_IDS[0] ?? null);
    await seedPosts(org, cuso.projectId, cuso.sokoBotId);

    const canceled = await sokoBotControlPlane.archive(
      org.ownerId,
      org.workspaceId,
      { kind: "id", sokoBotId: cuso.sokoBotId },
    );

    expect(canceled).toBe(3);
    expect(await statusesOf(cuso.projectId)).toEqual({
      "A DRAFT post": "CANCELED",
      "A NEEDS_APPROVAL post": "CANCELED",
      "A SCHEDULED post": "CANCELED",
      "A FAILED post": "FAILED",
      "A PUBLISHED post": "PUBLISHED",
    });
    expect(
      await prisma.sokoBot.findUnique({
        where: { id: cuso.sokoBotId },
        select: { status: true },
      }),
    ).toEqual({ status: "PAUSED" });

    // Archived already: nothing more to cancel.
    expect(
      await sokoBotControlPlane.archive(org.ownerId, org.workspaceId, {
        kind: "id",
        sokoBotId: cuso.sokoBotId,
      }),
    ).toBe(0);
  });

  it("leaves the Project's posts alone when the bot is not Cuso", async () => {
    const org = await seedOrganization();
    const bot = await seedSharedBot(org, null);
    await seedPosts(org, bot.projectId, bot.sokoBotId);

    const canceled = await sokoBotControlPlane.archive(
      org.ownerId,
      org.workspaceId,
      { kind: "id", sokoBotId: bot.sokoBotId },
    );

    expect(canceled).toBe(0);
    expect(await statusesOf(bot.projectId)).toMatchObject({
      "A DRAFT post": "DRAFT",
      "A SCHEDULED post": "SCHEDULED",
    });
  });
});
