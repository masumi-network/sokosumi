import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const migrationSql = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20260929140000_task_number/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const userId = randomUUID();
const workspaceId = randomUUID();

async function createProject(name: string): Promise<string> {
  const project = await prisma.project.create({
    data: { workspaceId, name },
  });
  return project.id;
}

async function createTask(projectId: string | null): Promise<string> {
  const task = await prisma.task.create({
    data: {
      ownerId: userId,
      creatorUserId: userId,
      workspaceId,
      projectId,
      name: "Numbered task",
    },
  });
  return task.id;
}

async function numberOf(taskId: string): Promise<number | null> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { number: true },
  });
  return task.number;
}

async function aliasesOf(projectId: string) {
  return prisma.taskIdentifierAlias.findMany({
    where: { projectId },
    orderBy: { number: "asc" },
    select: { number: true, taskId: true },
  });
}

// Real migration SQL, real Prisma. The backfill test replays the migration on
// stub tables holding pre-migration rows; the rest uses the migrated schema.
describe.skipIf(!enabled)("task numbers against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Task number fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("backfills tasks per project in creation order and sets the counters", async () => {
    await prisma.$transaction(
      async (tx) => {
        const schema = `number_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(
          "CREATE TABLE project (id uuid PRIMARY KEY, name text)",
        );
        await tx.$executeRawUnsafe(
          'CREATE TABLE task (id text PRIMARY KEY, "projectId" uuid REFERENCES project(id) ON DELETE SET NULL, "createdAt" timestamp NOT NULL)',
        );
        const one = randomUUID();
        const two = randomUUID();
        const empty = randomUUID();
        await tx.$executeRaw`INSERT INTO project VALUES (${one}::uuid, 'one'), (${two}::uuid, 'two'), (${empty}::uuid, 'empty')`;
        await tx.$executeRaw`INSERT INTO task VALUES
          ('b', ${one}::uuid, '2026-01-02'),
          ('a', ${one}::uuid, '2026-01-01'),
          ('tie-2', ${one}::uuid, '2026-01-03'),
          ('tie-1', ${one}::uuid, '2026-01-03'),
          ('x', ${two}::uuid, '2026-01-05'),
          ('loose', NULL, '2026-01-01')`;

        await tx.$executeRawUnsafe(migrationSql);

        const tasks = await tx.$queryRaw<
          { id: string; number: number | null }[]
        >`
          SELECT id, number FROM task ORDER BY id`;
        expect(Object.fromEntries(tasks.map((t) => [t.id, t.number]))).toEqual({
          a: 1,
          b: 2,
          "tie-1": 3,
          "tie-2": 4,
          x: 1,
          loose: null,
        });
        const counters = await tx.$queryRaw<
          { name: string; taskCounter: number }[]
        >`
          SELECT name, "taskCounter" FROM project ORDER BY name`;
        expect(
          Object.fromEntries(counters.map((p) => [p.name, p.taskCounter])),
        ).toEqual({ one: 4, two: 1, empty: 0 });

        // The backfill did not consume counters: the next insert continues.
        await tx.$executeRaw`INSERT INTO task VALUES ('next', ${one}::uuid, '2026-02-01')`;
        const [next] = await tx.$queryRaw<{ number: number }[]>`
          SELECT number FROM task WHERE id = 'next'`;
        expect(next?.number).toBe(5);
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });

  it("numbers tasks 1, 2, 3 per project, independently, and leaves loose tasks unnumbered", async () => {
    const a = await createProject("Alpha");
    const b = await createProject("Beta");
    const numbers = [
      await createTask(a),
      await createTask(a),
      await createTask(b),
      await createTask(a),
      await createTask(null),
      await createTask(b),
    ].map(numberOf);

    expect(await Promise.all(numbers)).toEqual([1, 2, 1, 3, null, 2]);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: a } }))
        .taskCounter,
    ).toBe(3);
  });

  it("stays unique when many tasks are created at once", async () => {
    const project = await createProject("Race");
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => createTask(project)),
    );
    const numbers = (await Promise.all(ids.map(numberOf))).sort(
      (x, y) => (x ?? 0) - (y ?? 0),
    );
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("gives a moved task a new number and keeps the old one as an alias", async () => {
    const from = await createProject("From");
    const to = await createProject("To");
    await createTask(from);
    const moved = await createTask(from);
    await createTask(to);

    await prisma.task.update({ where: { id: moved }, data: { projectId: to } });

    expect(await numberOf(moved)).toBe(2);
    expect(await aliasesOf(from)).toEqual([{ number: 2, taskId: moved }]);
    expect(await aliasesOf(to)).toEqual([]);
  });

  it("numbers a task anew when it moves back, not reusing the old number", async () => {
    const from = await createProject("Home");
    const to = await createProject("Away");
    const moved = await createTask(from);

    await prisma.task.update({ where: { id: moved }, data: { projectId: to } });
    await prisma.task.update({
      where: { id: moved },
      data: { projectId: from },
    });

    expect(await numberOf(moved)).toBe(2);
    expect(await aliasesOf(from)).toEqual([{ number: 1, taskId: moved }]);
    expect(await aliasesOf(to)).toEqual([{ number: 1, taskId: moved }]);
  });

  it("clears the number and aliases the old one when the task leaves its project", async () => {
    const project = await createProject("Leave");
    const task = await createTask(project);

    await prisma.task.update({
      where: { id: task },
      data: { projectId: null },
    });

    expect(await numberOf(task)).toBeNull();
    expect(await aliasesOf(project)).toEqual([{ number: 1, taskId: task }]);
  });

  it("ignores writes to number and keeps the assigned one", async () => {
    const project = await createProject("Frozen");
    const task = await createTask(project);

    await prisma.task.update({ where: { id: task }, data: { number: 99 } });

    expect(await numberOf(task)).toBe(1);
  });

  it("deletes a project with tasks: tasks end unnumbered and no alias rows remain", async () => {
    const project = await createProject("Doomed");
    const first = await createTask(project);
    const second = await createTask(project);

    await prisma.project.delete({ where: { id: project } });

    expect(await numberOf(first)).toBeNull();
    expect(await numberOf(second)).toBeNull();
    expect(await aliasesOf(project)).toEqual([]);
  });
});
