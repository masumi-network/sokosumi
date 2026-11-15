/**
 * Folder stars follow a folder that moves, while other people star and
 * unstar at the same time. These are races, so they run on PostgreSQL with a
 * second connection standing in for the other writer.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/drive-blob", () => ({ driveHasAny: async () => true }));

import prisma from "@/lib/db/prisma";
import {
  listDriveStars,
  rebaseDriveFolderStars,
  setDriveStar,
} from "./drive-star.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const bob = randomUUID();
const workspaceId = randomUUID();

function storeOf(userId: string) {
  return {
    workspaceId,
    scope: "user" as const,
    ownerId: alice,
    actor: { userId, organizationId: null, kind: "interactive" as const },
  };
}

async function star(userId: string, folderPath: string) {
  await prisma.driveStar.create({ data: { userId, workspaceId, folderPath } });
}

async function starredPaths(userId: string) {
  const rows = await prisma.driveStar.findMany({
    where: { userId, workspaceId },
    select: { folderPath: true },
  });
  return rows.map((row) => row.folderPath).sort();
}

const moveFinance = () =>
  rebaseDriveFolderStars({
    workspaceId,
    fromFolderPath: "Finance",
    toFolderPath: "Archive/Finance",
  });

describe.runIf(enabled)("folder stars on PostgreSQL", () => {
  beforeAll(async () => {
    for (const id of [alice, bob])
      await prisma.user.create({
        data: {
          id,
          name: "Star test",
          email: `star-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.workspace.create({ data: { id: workspaceId, userId: alice } });
  });
  beforeEach(async () => {
    await prisma.driveStar.deleteMany({ where: { workspaceId } });
  });
  afterAll(async () => {
    await prisma.driveStar.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  });

  it("moves stars with the folder and keeps stars already on the destination", async () => {
    await star(alice, "Finance");
    await star(alice, "Finance/Q4");
    await star(alice, "Archive/Finance");
    await star(bob, "Archive/Finance");

    await moveFinance();

    expect(await starredPaths(alice)).toEqual([
      "Archive/Finance",
      "Archive/Finance/Q4",
    ]);
    expect(await starredPaths(bob)).toEqual(["Archive/Finance"]);
  });

  it("is safe to run again after a retried move", async () => {
    await star(alice, "Finance");

    await moveFinance();
    await moveFinance();

    expect(await starredPaths(alice)).toEqual(["Archive/Finance"]);
  });

  it("an unstar that commits first stays unstarred", async () => {
    await star(alice, "Finance");

    await setDriveStar({
      store: storeOf(alice),
      target: { kind: "folder", folderPath: "Finance" },
      starred: false,
    });
    await moveFinance();

    expect(await starredPaths(alice)).toEqual([]);
  });

  it("an unstar still in flight when the move runs does not fail the move", async () => {
    await star(alice, "Finance");
    const other = new Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query(
        `DELETE FROM drive_star WHERE "userId" = $1 AND "folderPath" = 'Finance'`,
        [alice],
      );
      const move = moveFinance();
      // Let the move reach the row the other connection holds.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await other.query("COMMIT");
      await expect(move).resolves.toBeUndefined();
    } finally {
      await other.end();
    }
    expect(await starredPaths(alice)).not.toContain("Finance");
  });

  it("lists every star, not the newest 50", async () => {
    for (let index = 0; index < 51; index++)
      await star(alice, `Folder ${index}`);

    const stars = await listDriveStars(storeOf(alice));

    expect(stars.folders).toHaveLength(51);
  });

  it("never shows one person's stars to another", async () => {
    await star(alice, "Finance");

    const stars = await listDriveStars(storeOf(bob));

    expect(stars).toEqual({ folders: [], files: [] });
  });
});
