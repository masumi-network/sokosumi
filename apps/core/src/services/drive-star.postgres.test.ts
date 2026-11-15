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

const blob = vi.hoisted(() => ({ driveHasAny: vi.fn() }));
vi.mock("@/lib/drive-blob", () => blob);

import prisma from "@/lib/db/prisma";
import {
  deleteDriveFolderStars,
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

/**
 * Waits until PostgreSQL shows the state an interleaving needs, instead of
 * sleeping and hoping. Fails after three seconds.
 */
async function waitUntil(other: Client, sql: string) {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const { rows } = await other.query<{ ok: boolean }>(sql);
    if (rows[0]?.ok) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${sql}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Some other backend in this database is blocked on a lock. */
const SOMEONE_WAITS = `SELECT EXISTS (
  SELECT 1 FROM pg_stat_activity
  WHERE datname = current_database() AND wait_event_type = 'Lock'
    AND pid <> pg_backend_pid()) AS ok`;
/** Some other backend holds an advisory lock. */
const ADVISORY_HELD = `SELECT EXISTS (
  SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
  WHERE l.locktype = 'advisory' AND l.granted
    AND a.datname = current_database() AND l.pid <> pg_backend_pid()) AS ok`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.runIf(enabled)("folder stars on PostgreSQL", () => {
  let other: Client;
  beforeAll(async () => {
    other = new Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
  });
  afterAll(async () => {
    await other.end();
  });

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
    blob.driveHasAny.mockReset();
    blob.driveHasAny.mockResolvedValue(true);
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

  it("an unstar in flight when the move runs leaves no star anywhere", async () => {
    await star(alice, "Finance");
    await other.query("BEGIN");
    await other.query(
      `DELETE FROM drive_star WHERE "userId" = $1 AND "folderPath" = 'Finance'`,
      [alice],
    );

    const move = moveFinance();
    await waitUntil(other, SOMEONE_WAITS);
    await other.query("COMMIT");
    await move;

    expect(await starredPaths(alice)).toEqual([]);
  });

  it("an unstar in flight that rolls back moves with the folder", async () => {
    await star(alice, "Finance");
    await other.query("BEGIN");
    await other.query(
      `DELETE FROM drive_star WHERE "userId" = $1 AND "folderPath" = 'Finance'`,
      [alice],
    );

    const move = moveFinance();
    await waitUntil(other, SOMEONE_WAITS);
    await other.query("ROLLBACK");
    await move;

    expect(await starredPaths(alice)).toEqual(["Archive/Finance"]);
  });

  it("a star that saw the folder before the move is moved with it", async () => {
    const folderSeen = deferred<boolean>();
    blob.driveHasAny.mockReturnValueOnce(folderSeen.promise);

    const starring = setDriveStar({
      store: storeOf(alice),
      target: { kind: "folder", folderPath: "Finance" },
      starred: true,
    });
    await waitUntil(other, ADVISORY_HELD);
    const move = moveFinance();
    await waitUntil(other, SOMEONE_WAITS);
    folderSeen.resolve(true);
    await starring;
    await move;

    expect(await starredPaths(alice)).toEqual(["Archive/Finance"]);
  });

  it("a star that saw the folder before it was deleted goes with it", async () => {
    const folderSeen = deferred<boolean>();
    blob.driveHasAny.mockReturnValueOnce(folderSeen.promise);

    const starring = setDriveStar({
      store: storeOf(alice),
      target: { kind: "folder", folderPath: "Finance" },
      starred: true,
    });
    await waitUntil(other, ADVISORY_HELD);
    const removal = deleteDriveFolderStars({
      workspaceId,
      folderPath: "Finance",
    });
    await waitUntil(other, SOMEONE_WAITS);
    folderSeen.resolve(true);
    await starring;
    await removal;

    expect(await starredPaths(alice)).toEqual([]);
  });

  it("a star after the move finds the folder gone", async () => {
    await moveFinance();
    blob.driveHasAny.mockResolvedValue(false);

    await expect(
      setDriveStar({
        store: storeOf(alice),
        target: { kind: "folder", folderPath: "Finance" },
        starred: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await starredPaths(alice)).toEqual([]);
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
