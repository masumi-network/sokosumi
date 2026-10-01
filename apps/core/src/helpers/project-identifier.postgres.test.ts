import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isProjectIdentifierUniqueConstraintError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const migrationSql = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20260929130000_project_identifier/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userIds: string[] = [];

// A workspace needs an owner (DB check), so each one comes with a user.
async function createWorkspace(id: string): Promise<void> {
  const userId = randomUUID();
  userIds.push(userId);
  await prisma.user.create({
    data: {
      id: userId,
      name: "Project identifier fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id } },
    },
  });
}

async function identifiers(workspaceId: string): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { identifier: true },
  });
  return rows.map((row) => row.identifier ?? "<null>");
}

// Real migration SQL, real Prisma. The backfill test replays the migration on
// a stub table holding pre-migration rows; the rest uses the migrated schema.
describe.skipIf(!enabled)("project identifier against PostgreSQL", () => {
  beforeAll(async () => {
    await createWorkspace(workspaceA);
    await createWorkspace(workspaceB);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("backfills existing projects uniquely per workspace, oldest first", async () => {
    const wsOne = randomUUID();
    const wsTwo = randomUUID();
    const wsThree = randomUUID();
    await prisma.$transaction(
      async (tx) => {
        const schema = `identifier_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(
          'CREATE TABLE project (id text PRIMARY KEY, "workspaceId" uuid NOT NULL, name text NOT NULL, "createdAt" timestamp NOT NULL)',
        );
        await tx.$executeRaw`INSERT INTO project VALUES
          ('c', ${wsOne}::uuid, 'sok', '2026-01-03'),
          ('a', ${wsOne}::uuid, 'Sokosumi', '2026-01-01'),
          ('b', ${wsOne}::uuid, 'Sokosumi Web', '2026-01-02'),
          ('d', ${wsTwo}::uuid, 'Sokosumi', '2026-01-01'),
          ('e', ${wsOne}::uuid, '42 Labs', '2026-01-04'),
          ('f', ${wsOne}::uuid, '🚀', '2026-01-05'),
          ('g', ${wsOne}::uuid, 'A', '2026-01-06'),
          ('h', ${wsThree}::uuid, 'Sōkosumi', '2026-01-02'),
          ('i', ${wsTwo}::uuid, 'Café', '2026-01-03')`;

        await tx.$executeRawUnsafe(migrationSql);

        const rows = await tx.$queryRaw<{ id: string; identifier: string }[]>`
          SELECT id, identifier FROM project ORDER BY id`;
        expect(
          Object.fromEntries(rows.map((r) => [r.id, r.identifier])),
        ).toEqual({
          a: "SOK",
          b: "SOK2",
          c: "SOK3",
          d: "SOK",
          e: "P42",
          f: "PRJ",
          g: "AX",
          h: "SOK",
          i: "CAF",
        });
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });

  it("derives the identifier from the name on insert and suffixes collisions", async () => {
    for (const name of ["Sokosumi", "Sokosumi Web", "sok"]) {
      await prisma.project.create({ data: { workspaceId: workspaceA, name } });
    }
    await prisma.project.create({
      data: { workspaceId: workspaceB, name: "Sokosumi" },
    });

    expect(await identifiers(workspaceA)).toEqual(["SOK", "SOK2", "SOK3"]);
    expect(await identifiers(workspaceB)).toEqual(["SOK"]);
  });

  it("keeps an explicit identifier and skips it when deriving", async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    try {
      await prisma.project.create({
        data: { workspaceId: ws, name: "Whatever", identifier: "ABC" },
      });
      await prisma.project.create({ data: { workspaceId: ws, name: "abc" } });
      expect(await identifiers(ws)).toEqual(["ABC", "ABC2"]);
    } finally {
      await prisma.project.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("stays unique when many projects are created at once", async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    try {
      await Promise.all(
        Array.from({ length: 12 }, () =>
          prisma.project.create({ data: { workspaceId: ws, name: "Race" } }),
        ),
      );
      const values = await identifiers(ws);
      expect(new Set(values).size).toBe(12);
      expect(values).toContain("RAC");
      expect(values).toContain("RAC12");
    } finally {
      await prisma.project.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("lets automatic allocation wait on an explicit identifier insert", async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    try {
      // Explicit FOO and auto "Foo" must serialize on the same lock: every
      // automatic create must succeed (FOO2…) instead of losing a unique-index
      // race to an explicit FOO.
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          i % 2 === 0
            ? prisma.project.create({
                data: { workspaceId: ws, name: "Foo", identifier: "FOO" },
              })
            : prisma.project.create({
                data: { workspaceId: ws, name: "Foo" },
              }),
        ),
      );
      const explicit = results.filter((_, i) => i % 2 === 0);
      const automatic = results.filter((_, i) => i % 2 === 1);
      expect(automatic.every((r) => r.status === "fulfilled")).toBe(true);
      const explicitOk = explicit.filter((r) => r.status === "fulfilled");
      expect(explicitOk.length).toBeLessThanOrEqual(1);
      for (const result of explicit) {
        if (result.status === "rejected") {
          expect(isProjectIdentifierUniqueConstraintError(result.reason)).toBe(
            true,
          );
        }
      }
      const values = await identifiers(ws);
      expect(values).toContain("FOO");
      expect(new Set(values).size).toBe(values.length);
      expect(values.length).toBe(automatic.length + explicitOk.length);
    } finally {
      await prisma.project.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("rejects a duplicate explicit identifier with a recognisable error", async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    try {
      await prisma.project.create({
        data: { workspaceId: ws, name: "One", identifier: "DUP" },
      });
      const error = await prisma.project
        .create({ data: { workspaceId: ws, name: "Two", identifier: "DUP" } })
        .catch((e: unknown) => e);
      expect(isProjectIdentifierUniqueConstraintError(error)).toBe(true);
    } finally {
      await prisma.project.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("rejects identifiers outside the allowed format", async () => {
    for (const identifier of ["sok", "S", "1AB", "ABCDEFGH", "S-K"]) {
      await expect(
        prisma.project.create({
          data: { workspaceId: workspaceB, name: "Bad", identifier },
        }),
      ).rejects.toThrow();
    }
  });
});
