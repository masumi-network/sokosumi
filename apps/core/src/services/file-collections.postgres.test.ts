import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

/**
 * A collection its author cannot see is the failure worth testing for.
 *
 * `resolveFileRequestContext` turns scope plus organizationId into a
 * workspace, and a collection is keyed on `(workspaceId, ownerUserId)`.
 * Saving under one scope and listing under another therefore hides the
 * collection from the person who just saved it — the same trap the detail
 * route hit, where the scope was resolved twice and disagreed once.
 *
 * The UI avoids it by passing one `store` object to both calls. These tests
 * pin the server behaviour that makes that the right fix, and show what
 * going wrong looks like.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let userId = "";
let personalWorkspaceId = "";
let otherWorkspaceId = "";

async function saveCollection(input: {
  workspaceId: string;
  ownerUserId: string;
  name: string;
  definition: Prisma.InputJsonValue;
}) {
  return prisma.fileCollection.create({
    data: {
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      definition: input.definition,
    },
    select: { id: true, name: true, definitionVersion: true },
  });
}

function listFor(workspaceId: string, ownerUserId: string) {
  return prisma.fileCollection.findMany({
    where: { workspaceId, OR: [{ ownerUserId }, { isShared: true }] },
    select: { id: true, name: true },
  });
}

describe.skipIf(!enabled)("saved collections", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Collection owner",
        email: `collections-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;

    personalWorkspaceId = (
      await prisma.workspace.create({
        data: { userId },
        select: { id: true },
      })
    ).id;

    const otherUser = await prisma.user.create({
      data: {
        name: "Other workspace",
        email: `collections-other-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    otherWorkspaceId = (
      await prisma.workspace.create({
        data: { userId: otherUser.id },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.fileCollection.deleteMany({
      where: { workspaceId: { in: [personalWorkspaceId, otherWorkspaceId] } },
    });
  });

  it("shows an author the collection they just saved", async () => {
    const saved = await saveCollection({
      workspaceId: personalWorkspaceId,
      ownerUserId: userId,
      name: "Invoices",
      definition: { query: "invoice" },
    });

    const listed = await listFor(personalWorkspaceId, userId);
    expect(listed.map((row) => row.id)).toContain(saved.id);
  });

  it("hides it when the listing scope is not the saving scope", async () => {
    // The trap, made explicit: same author, different workspace, nothing
    // found. This is what a UI that saves with one store and lists with
    // another produces, and why both calls take the same `store`.
    const saved = await saveCollection({
      workspaceId: personalWorkspaceId,
      ownerUserId: userId,
      name: "Invoices",
      definition: { query: "invoice" },
    });

    const listed = await listFor(otherWorkspaceId, userId);
    expect(listed.map((row) => row.id)).not.toContain(saved.id);
  });

  it("bumps the definition version when the filters are re-saved", async () => {
    const saved = await saveCollection({
      workspaceId: personalWorkspaceId,
      ownerUserId: userId,
      name: "Invoices",
      definition: { query: "invoice" },
    });

    const updated = await prisma.fileCollection.update({
      where: { id: saved.id },
      data: {
        definition: { query: "invoice 2026" },
        definitionVersion: { increment: 1 },
      },
      select: { definitionVersion: true, definition: true },
    });

    // A reader holding the old definition can tell that it moved.
    expect(updated.definitionVersion).toBe(saved.definitionVersion + 1);
    expect(updated.definition).toMatchObject({ query: "invoice 2026" });
  });

  it("keeps one author's names unique without blocking another's", async () => {
    await saveCollection({
      workspaceId: personalWorkspaceId,
      ownerUserId: userId,
      name: "Invoices",
      definition: {},
    });

    await expect(
      saveCollection({
        workspaceId: personalWorkspaceId,
        ownerUserId: userId,
        name: "Invoices",
        definition: {},
      }),
    ).rejects.toThrow();

    // The same name in another workspace is a different collection.
    await expect(
      saveCollection({
        workspaceId: otherWorkspaceId,
        ownerUserId: userId,
        name: "Invoices",
        definition: {},
      }),
    ).resolves.toBeDefined();
  });
});
