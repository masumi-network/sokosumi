import { randomUUID } from "node:crypto";
import { Prisma, TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { type MoveTaskInput, moveTask } from "@/helpers/task-subtask-move";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  createTaskForActor,
  updateTaskForActor,
} from "@/services/task-domain.service";
import { archiveTaskRecord } from "@/services/task-domain-archive";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const userContext = {
  source: "context" as const,
  userId,
  organizationId: null,
};
// Long enough that the other transaction detects a deadlock first, so a
// deadlock shows as that transaction's failure.
const MOVE_DEADLOCK_TIMEOUT = "30s";
const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_ATTEMPTS = 250;

/** Ids in ascending order, so a test controls which row a sorted lock takes first. */
function sortedIds(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID()).sort();
}

async function createTask(
  name: string,
  input: {
    id?: string;
    projectId?: string | null;
    parentTaskId?: string;
    status?: TaskStatus;
  } = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      ...(input.id !== undefined ? { id: input.id } : {}),
      ownerId: userId,
      creatorUserId: userId,
      workspaceId,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      position: input.parentTaskId ? 1 : null,
      status: input.status ?? TaskStatus.DRAFT,
      name,
    },
  });
  return task.id;
}

async function createProject(name: string): Promise<string> {
  return (await prisma.project.create({ data: { workspaceId, name } })).id;
}

async function freezeSeoAnalysis(taskId: string, projectId: string) {
  await prisma.projectSeoAnalysis.create({
    data: {
      projectId,
      idempotencyKey: randomUUID(),
      requestHash: "subtask-move-fixture",
      kind: "page_check",
      taskId,
      pageIds: [],
      requestedBy: userId,
      request: { version: 1, kind: "page_check" },
    },
  });
}

function move(input: MoveTaskInput) {
  return serializableTransaction(
    (tx) => moveTask(tx, userContext, input),
    "Task changed while moving it",
  );
}

async function sokoBotProjectMoveIn(
  tx: Prisma.TransactionClient,
  taskId: string,
  projectId: string,
  extra: { name?: string } = {},
) {
  const { updatedAt } = await tx.task.findUniqueOrThrow({
    where: { id: taskId },
  });
  return updateTaskForActor(
    {
      actor: { kind: "soko_bot", sokoBotId: randomUUID() },
      userId,
      workspaceId,
      intent: "metadata",
      taskId,
      projectId,
      expectedUpdatedAt: updatedAt,
      ...extra,
    },
    tx,
  );
}

function sokoBotProjectMove(taskId: string, projectId: string) {
  return prisma.$transaction((tx) =>
    sokoBotProjectMoveIn(tx, taskId, projectId),
  );
}

/** The backend that runs this transaction. */
async function backendPid(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<[{ pid: number }]>`
    SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

/**
 * Resolves once a backend waits on a lock that `blocker` holds. Only that
 * backend counts, so a test file that runs at the same time cannot open the
 * gate early.
 */
async function waitForLockWaiter(blocker: number): Promise<void> {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE ${blocker}::int = ANY(pg_blocking_pids(pid))
    `;
    if (row && row.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
  throw new Error("No transaction started waiting for a lock");
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function placement(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { parentTaskId: true, projectId: true, archivedAt: true },
  });
}

// Real Prisma, triggers and locks (SOKD-279 review fixes).
describe.skipIf(!enabled)("moveTask against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Sub-task move fixture",
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
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("refuses a Project change by move when a sub-task below the Task is parked or a frozen SEO analysis", async () => {
    const [home, away] = [
      await createProject("Guard home"),
      await createProject("Guard away"),
    ];
    const parent = await createTask("Guard parent", { projectId: away });

    const parkedRoot = await createTask("Parked root", { projectId: home });
    const parkedStep = await createTask("Parked step", {
      projectId: home,
      parentTaskId: parkedRoot,
    });
    await createTask("Parked grandchild", {
      projectId: home,
      parentTaskId: parkedStep,
      status: TaskStatus.GRANT_PENDING,
    });
    await expect(
      move({ taskId: parkedRoot, parentTaskId: parent }),
    ).rejects.toThrow("Parked tasks cannot be modified");

    const seoRoot = await createTask("SEO root", { projectId: home });
    const seoStep = await createTask("SEO step", {
      projectId: home,
      parentTaskId: seoRoot,
    });
    await freezeSeoAnalysis(seoStep, home);
    await expect(
      move({ taskId: seoRoot, parentTaskId: parent }),
    ).rejects.toThrow("This SEO analysis request is frozen");

    for (const taskId of [parkedRoot, seoRoot, seoStep]) {
      expect((await placement(taskId)).projectId).toBe(home);
    }
  });

  it("refuses a domain-service Project move of a Task whose sub-task is a frozen SEO analysis", async () => {
    const [home, away] = [
      await createProject("Bot home"),
      await createProject("Bot away"),
    ];
    const root = await createTask("Bot root", { projectId: home });
    const step = await createTask("Bot step", {
      projectId: home,
      parentTaskId: root,
    });
    await freezeSeoAnalysis(step, home);
    const { updatedAt } = await prisma.task.findUniqueOrThrow({
      where: { id: root },
    });

    await expect(
      prisma.$transaction((tx) =>
        updateTaskForActor(
          {
            actor: { kind: "user", userId },
            userId,
            intent: "metadata",
            taskId: root,
            projectId: away,
            expectedUpdatedAt: updatedAt,
          },
          tx,
        ),
      ),
    ).rejects.toThrow("This SEO analysis request is frozen");
    expect((await placement(step)).projectId).toBe(home);
  });

  it("refuses a Soko Bot Project move of a sub-task, or of a Task whose sub-task is parked", async () => {
    const [home, away] = [
      await createProject("Soko home"),
      await createProject("Soko away"),
    ];
    const root = await createTask("Soko root", { projectId: home });
    const step = await createTask("Soko step", {
      projectId: home,
      parentTaskId: root,
      status: TaskStatus.GRANT_PENDING,
    });

    for (const [taskId, message] of [
      [step, "A sub-task stays in its parent's project"],
      [root, "Parked tasks cannot be modified"],
    ]) {
      await expect(sokoBotProjectMove(taskId, away)).rejects.toThrow(message);
    }
    for (const taskId of [root, step]) {
      expect((await placement(taskId)).projectId).toBe(home);
    }
  });

  for (const [branch, extra] of [
    ["a Project move alone", {}],
    ["a Project move with other fields", { name: "Renamed by the bot" }],
  ] as const) {
    it(`locks the Task before its sub-tasks in ${branch} by Soko Bot, so an archive of the Task does not deadlock with it`, async () => {
      const [home, away] = [
        await createProject(`Lock home ${branch}`),
        await createProject(`Lock away ${branch}`),
      ];
      const root = await createTask("Lock root", { projectId: home });
      await createTask("Lock step", { projectId: home, parentTaskId: root });

      let moving: Promise<{ ok: boolean; error?: unknown }> | undefined;
      const archive = settle(
        prisma.$transaction(
          async (tx) => {
            // The archive has taken the Task and goes on to its sub-task.
            await lockTaskRows(tx, [root]);
            moving = settle(
              prisma.$transaction(
                async (moveTx) => {
                  await moveTx.$executeRawUnsafe(
                    `SET LOCAL deadlock_timeout = '${MOVE_DEADLOCK_TIMEOUT}'`,
                  );
                  return sokoBotProjectMoveIn(moveTx, root, away, extra);
                },
                {
                  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                  timeout: 60_000,
                },
              ),
            );
            await waitForLockWaiter(await backendPid(tx));
            const task = await tx.task.findUniqueOrThrow({
              where: { id: root },
            });
            await archiveTaskRecord(tx, task);
          },
          { timeout: 30_000 },
        ),
      );

      expect(await archive).toEqual({ ok: true, value: undefined });
      const moved = await moving;
      expect(moved?.ok).toBe(false);
      expect(isPrismaTransactionConflict(moved?.error)).toBe(true);
      expect((await placement(root)).projectId).toBe(home);
    });
  }

  for (const [branch, extra] of [
    ["a Project move alone", {}],
    ["a Project move with other fields", { name: "Renamed by the bot" }],
  ] as const) {
    it(`locks the Workspace and both Projects before the Task in ${branch} by Soko Bot, so a sub-task create under the Task does not deadlock with it`, async () => {
      // The create locks the Workspace and the Project, then the parent. The
      // Project change once locked the Task first, then its update keyed the
      // old Project: each waited for the other (SOKD-279 review).
      const [home, away] = [
        await createProject(`Order home ${branch}`),
        await createProject(`Order away ${branch}`),
      ];
      const root = await createTask("Order root", { projectId: home });
      const step = await createTask("Order step", {
        projectId: home,
        parentTaskId: root,
      });

      let botStarted = (_pid: number) => {};
      const botPid = new Promise<number>((resolve) => {
        botStarted = resolve;
      });
      let changing: Promise<{ ok: boolean; error?: unknown }> | undefined;
      let creating: Promise<{ ok: boolean; error?: unknown }> | undefined;
      await prisma.$transaction(
        async (gate) => {
          // Holds the sub-task, so the Project change stops at it.
          await lockTaskRows(gate, [step]);
          changing = settle(
            prisma.$transaction(
              async (botTx) => {
                botStarted(await backendPid(botTx));
                return sokoBotProjectMoveIn(botTx, root, away, extra);
              },
              { timeout: 60_000 },
            ),
          );
          await waitForLockWaiter(await backendPid(gate));
          creating = settle(
            prisma.$transaction(
              async (createTx) => {
                await createTx.$executeRawUnsafe(
                  `SET LOCAL deadlock_timeout = '${MOVE_DEADLOCK_TIMEOUT}'`,
                );
                return createTaskForActor(
                  {
                    actor: { kind: "user", userId },
                    ownerId: userId,
                    organizationId: null,
                    workspaceId,
                    name: "Order late step",
                    status: TaskStatus.DRAFT,
                    parent: { taskId: root },
                  },
                  createTx,
                );
              },
              { timeout: 60_000 },
            ),
          );
          await waitForLockWaiter(await botPid);
        },
        { timeout: 30_000 },
      );

      expect(await changing).toMatchObject({ ok: true });
      // The create waited for the change, then found its parent moved.
      const created = await creating;
      expect(created?.ok).toBe(false);
      expect(created?.error).toMatchObject({
        status: 409,
        message: "Parent Task changed while adding a sub-task",
      });
      expect((await placement(root)).projectId).toBe(away);
    });
  }

  it("moves a Task to another parent's Project only in a status PATCH can edit", async () => {
    const [home, away] = [
      await createProject("Status home"),
      await createProject("Status away"),
    ];
    const awayParent = await createTask("Status away parent", {
      projectId: away,
    });
    const homeParent = await createTask("Status home parent", {
      projectId: home,
    });
    const done = await createTask("Done", {
      projectId: home,
      status: TaskStatus.COMPLETED,
    });

    await expect(
      move({ taskId: done, parentTaskId: awayParent }),
    ).rejects.toThrow("You can only update draft, queued, or ready tasks");
    expect(await placement(done)).toMatchObject({
      parentTaskId: null,
      projectId: home,
    });
    // The same Project: no Project change, so any status may move.
    await move({ taskId: done, parentTaskId: homeParent });
    expect((await placement(done)).parentTaskId).toBe(homeParent);
  });

  it("waits behind an archive of the old parent instead of deadlocking with it", async () => {
    // The Task sorts before its old parent: a sorted lock takes the Task
    // first, and the archive takes the old parent, then the Task.
    const [taskId, oldParentId, newParentId] = sortedIds(3);
    await createTask("Old parent", { id: oldParentId });
    await createTask("Leaving", { id: taskId, parentTaskId: oldParentId });
    await createTask("New parent", { id: newParentId });

    let moving: Promise<{ ok: boolean; error?: unknown }> | undefined;
    const archive = settle(
      prisma.$transaction(
        async (tx) => {
          await lockTaskRows(tx, [oldParentId]);
          moving = settle(
            prisma.$transaction(
              async (moveTx) => {
                await moveTx.$executeRawUnsafe(
                  `SET LOCAL deadlock_timeout = '${MOVE_DEADLOCK_TIMEOUT}'`,
                );
                return moveTask(moveTx, userContext, {
                  taskId,
                  parentTaskId: newParentId,
                });
              },
              {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                timeout: 60_000,
              },
            ),
          );
          await waitForLockWaiter(await backendPid(tx));
          const oldParent = await tx.task.findUniqueOrThrow({
            where: { id: oldParentId },
          });
          await archiveTaskRecord(tx, oldParent);
        },
        { timeout: 30_000 },
      ),
    );

    const archived = await archive;
    expect(archived).toEqual({ ok: true, value: undefined });
    // The move waited for the archive, then found the old parent changed.
    const moved = await moving;
    expect(moved?.ok).toBe(false);
    expect(isPrismaTransactionConflict(moved?.error)).toBe(true);
    expect(await placement(taskId)).toMatchObject({
      parentTaskId: oldParentId,
    });
    expect((await placement(taskId)).archivedAt).not.toBeNull();
  });

  it("locks a re-parent top-down by depth, so an archive of the old parent does not deadlock with it", async () => {
    // S < O < T by id. O has the sub-tasks S and T, and T moves under S. A
    // lock sorted by id alone took S, then O; the archive takes O, then S
    // and T, so the two deadlocked (SOKD-279 review).
    const [siblingId, oldParentId, taskId] = sortedIds(3);
    await createTask("Old parent", { id: oldParentId });
    await createTask("Sibling", { id: siblingId, parentTaskId: oldParentId });
    await createTask("Moving", { id: taskId, parentTaskId: oldParentId });

    let moving: Promise<{ ok: boolean; error?: unknown }> | undefined;
    const archive = settle(
      prisma.$transaction(
        async (tx) => {
          await lockTaskRows(tx, [oldParentId]);
          moving = settle(
            prisma.$transaction(
              async (moveTx) => {
                await moveTx.$executeRawUnsafe(
                  `SET LOCAL deadlock_timeout = '${MOVE_DEADLOCK_TIMEOUT}'`,
                );
                return moveTask(moveTx, userContext, {
                  taskId,
                  parentTaskId: siblingId,
                });
              },
              {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                timeout: 60_000,
              },
            ),
          );
          await waitForLockWaiter(await backendPid(tx));
          const oldParent = await tx.task.findUniqueOrThrow({
            where: { id: oldParentId },
          });
          await archiveTaskRecord(tx, oldParent);
        },
        { timeout: 30_000 },
      ),
    );

    const archived = await archive;
    expect(archived).toEqual({ ok: true, value: undefined });
    // The move waited for the archive on the old parent, then failed on it.
    const moved = await moving;
    expect(moved?.ok).toBe(false);
    expect(isPrismaTransactionConflict(moved?.error)).toBe(true);
    expect(await placement(taskId)).toMatchObject({
      parentTaskId: oldParentId,
    });
    expect((await placement(siblingId)).archivedAt).not.toBeNull();
  });

  it("fails a move whose snapshot predates a sub-task added below the Task, instead of nesting six levels deep", async () => {
    // The new parent sits at level 4, and the Task brings one level of
    // sub-tasks: level 5 is the limit. A second level added meanwhile makes 6.
    const chain = [await createTask("Race 0")];
    for (let level = 1; level <= 3; level += 1) {
      chain.push(
        await createTask(`Race ${level}`, { parentTaskId: chain[level - 1] }),
      );
    }
    const task = await createTask("Race task");
    const step = await createTask("Race step", { parentTaskId: task });

    const result = await settle(
      prisma.$transaction(
        async (tx) => {
          // The first read fixes this transaction's snapshot.
          await tx.task.findFirst({ where: { id: task } });
          // The real create path, which locks and writes the parent row.
          await prisma.$transaction((other) =>
            createTaskForActor(
              {
                actor: { kind: "user", userId },
                ownerId: userId,
                organizationId: null,
                workspaceId,
                name: "Race late step",
                status: TaskStatus.DRAFT,
                parent: { taskId: step },
              },
              other,
            ),
          );
          return moveTask(tx, userContext, {
            taskId: task,
            parentTaskId: chain[3],
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    expect(result.ok).toBe(false);
    expect(isPrismaTransactionConflict(result.ok ? null : result.error)).toBe(
      true,
    );
    expect((await placement(task)).parentTaskId).toBeNull();
    // The retry reads the new height and refuses.
    await expect(
      move({ taskId: task, parentTaskId: chain[3] }),
    ).rejects.toThrow("Sub-tasks nest at most 5 levels deep");
  });

  it("refuses a detach of a Task without a parent when afterTaskId is set", async () => {
    const root = await createTask("No parent");
    const other = await createTask("Other root");

    await expect(
      move({ taskId: root, parentTaskId: null, afterTaskId: other }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("returns 409 when the old parent is deleted while a detach waits for it", async () => {
    // The old parent sorts first, so the old code also waited on it.
    const [oldParentId, taskId] = sortedIds(2);
    await createTask("Deleted parent", { id: oldParentId });
    await createTask("Deleted with it", {
      id: taskId,
      parentTaskId: oldParentId,
    });

    let detaching: Promise<{ ok: boolean; error?: unknown }> | undefined;
    await prisma.$transaction(async (tx) => {
      await lockTaskRows(tx, [oldParentId]);
      detaching = settle(
        prisma.$transaction((detachTx) =>
          moveTask(detachTx, userContext, { taskId, parentTaskId: null }),
        ),
      );
      await waitForLockWaiter(await backendPid(tx));
      // The sub-task goes with it (ON DELETE CASCADE).
      await tx.task.delete({ where: { id: oldParentId } });
    });

    const detached = await detaching;
    expect(detached?.ok).toBe(false);
    expect(detached?.error).toMatchObject({
      status: 409,
      message: "Task changed while moving it. Retry.",
    });
  });
});
