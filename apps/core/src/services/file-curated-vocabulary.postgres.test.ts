import { randomUUID } from "node:crypto";

import { workspaceRepository } from "@sokosumi/database/repositories";
import { CURATED_FILE_VOCABULARY } from "@sokosumi/utils";
import { afterAll, describe, expect, it } from "vitest";

import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import prisma from "@/lib/db/prisma";

/**
 * A new workspace gets the curated Files vocabulary, from every creation path.
 *
 * The thing being prevented is not a small feature: `runSuggestionJob` counts
 * the workspace's labels, finds none, completes without calling the model and
 * reports success. So a workspace created without a vocabulary produces no tags
 * ever, and reports nothing wrong while doing it.
 *
 * `workspace-creation-chokepoint.test.ts` guards that no *new* creation site
 * appears without a seed. This one guards that the seed itself works, and that
 * running it twice is a no-op.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const organizationIds: string[] = [];

async function createUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `Seed ${tag}`,
      email: `seed-${tag}-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

describe.skipIf(!enabled)("curated vocabulary on workspace creation", () => {
  afterAll(async () => {
    if (!enabled) return;
    await prisma.workspace.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("seeds a personal workspace, and is a no-op the second time", async () => {
    const userId = await createUser("personal");

    const first = await createPersonalWorkspace(userId);

    const labels = await prisma.workspaceLabel.findMany({
      where: { workspaceId: first.id },
      select: { kind: true, displayName: true, createdByUserId: true },
    });
    expect(labels).toHaveLength(CURATED_FILE_VOCABULARY.length);
    expect(labels.filter((label) => label.kind === "CATEGORY")).toHaveLength(
      13,
    );
    expect(labels.filter((label) => label.kind === "TAG")).toHaveLength(24);

    // The null is the provenance marker: it is the only thing telling a label
    // the product shipped from one a person made.
    expect(
      labels.every((label) => label.createdByUserId === null),
      "product-seeded rows must leave createdByUserId null",
    ).toBe(true);

    // Idempotent on (workspaceId, kind, normalizedName).
    await prisma.$transaction((tx) =>
      workspaceRepository.seedCuratedVocabulary(first.id, tx),
    );
    await expect(
      prisma.workspaceLabel.count({
        where: { workspaceId: first.id },
      }),
    ).resolves.toBe(CURATED_FILE_VOCABULARY.length);
  }, 60_000);

  it("seeds an organization workspace", async () => {
    const ownerId = await createUser("org-owner");
    const organization = await prisma.organization.create({
      data: {
        name: `Seed Org ${suffix}`,
        slug: `seed-org-${suffix}`,
        createdAt: new Date(),
      },
      select: { id: true },
    });
    organizationIds.push(organization.id);

    const workspace = await prisma.$transaction((tx) =>
      workspaceRepository.upsertOrganizationWorkspace({
        organizationId: organization.id,
        tx,
      }),
    );

    await expect(
      prisma.workspaceLabel.count({ where: { workspaceId: workspace.id } }),
    ).resolves.toBe(CURATED_FILE_VOCABULARY.length);
    expect(ownerId).toBeTruthy();
  }, 60_000);

  it("never overwrites a label a person made", async () => {
    const userId = await createUser("collision");
    const workspace = await createPersonalWorkspace(userId);

    // Retire the curated Finance row and put a hand-made one in its place, the
    // way an old workspace that used the create route directly would look.
    await prisma.workspaceLabel.deleteMany({
      where: { workspaceId: workspace.id, normalizedName: "finance" },
    });
    const human = await prisma.workspaceLabel.create({
      data: {
        workspaceId: workspace.id,
        kind: "TAG",
        displayName: "FINANCE",
        normalizedName: "finance",
        description: "A person wrote this rubric",
        vocabularyVersion: 7,
        createdByUserId: userId,
      },
      select: { id: true },
    });

    await prisma.$transaction((tx) =>
      workspaceRepository.seedCuratedVocabulary(workspace.id, tx),
    );

    const after = await prisma.workspaceLabel.findUniqueOrThrow({
      where: { id: human.id },
      select: {
        displayName: true,
        description: true,
        vocabularyVersion: true,
        createdByUserId: true,
      },
    });

    // Untouched in every field. The row may already carry assignments and
    // rejection tombstones keyed on its id, and its description is the rubric
    // those were scored against.
    expect(after).toEqual({
      displayName: "FINANCE",
      description: "A person wrote this rubric",
      vocabularyVersion: 7,
      createdByUserId: userId,
    });

    // And no duplicate appeared beside it.
    await expect(
      prisma.workspaceLabel.count({
        where: { workspaceId: workspace.id, normalizedName: "finance" },
      }),
    ).resolves.toBe(1);
  }, 60_000);
});
