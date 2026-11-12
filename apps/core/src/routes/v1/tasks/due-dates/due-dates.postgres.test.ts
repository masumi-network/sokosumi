import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMoveOverdue from "./move-overdue/post";
import mountUndo from "./undo/post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

// Runs just before a Task's locks are taken, after it was selected: the
// window where a teammate can still change it.
const beforeLock = vi.hoisted(() => ({
  current: null as null | (() => Promise<void>),
}));

vi.mock("@/helpers/calendar-locks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/calendar-locks")>();
  return {
    ...actual,
    lockCalendarScope: async (
      ...args: Parameters<typeof actual.lockCalendarScope>
    ) => {
      const hook = beforeLock.current;
      beforeLock.current = null;
      await hook?.();
      return actual.lockCalendarScope(...args);
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const TODAY = "2026-11-12";
const TO = "2026-11-13";
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const adaPersonalWorkspaceId = randomUUID();
const bobPersonalWorkspaceId = randomUUID();

const ids = {
  overdue: randomUUID(),
  assignedToAda: randomUUID(),
  bobsOwn: randomUUID(),
  completed: randomUUID(),
  dueToday: randomUUID(),
  elsewhere: randomUUID(),
  laterFinished: randomUUID(),
  laterReassigned: randomUUID(),
};

function createApp(userId: string) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    await next();
  });
  app.onError(errorHandler);
  mountMoveOverdue(app);
  mountUndo(app);
  return app;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const response = await createApp(adaId).request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { data: T };
  expect(response.status, JSON.stringify(json)).toBe(200);
  return json.data;
}

interface Moved {
  moved: Array<{ id: string; from: string; version: string }>;
  skipped: number;
}

async function dueOf(id: string): Promise<string | undefined> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id } });
  return task.dueOn?.toISOString().slice(0, 10);
}

// Real Prisma against migrations: locks, @updatedAt and the locked recheck.
describe.skipIf(!enabled)("moving overdue Tasks", () => {
  beforeAll(async () => {
    for (const [id, personalWorkspaceId] of [
      [adaId, adaPersonalWorkspaceId],
      [bobId, bobPersonalWorkspaceId],
    ]) {
      await prisma.user.create({
        data: {
          id,
          name: "Due date fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: personalWorkspaceId } },
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId}`,
        createdAt: new Date(),
        members: {
          create: [
            { userId: adaId, role: "owner" },
            { userId: bobId, role: "owner" },
          ],
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    const base = {
      workspaceId,
      ownerId: adaId,
      organizationId,
      status: TaskStatus.DRAFT,
      visibility: TaskVisibility.PUBLIC,
    };
    await prisma.task.createMany({
      data: [
        { ...base, id: ids.overdue, name: "Overdue", dueOn: day("2026-11-02") },
        {
          ...base,
          id: ids.assignedToAda,
          name: "Bob's, assigned to Ada",
          ownerId: bobId,
          assigneeUserId: adaId,
          dueOn: day("2026-11-05"),
        },
        {
          ...base,
          id: ids.bobsOwn,
          name: "Bob's own",
          ownerId: bobId,
          dueOn: day("2026-11-05"),
        },
        {
          ...base,
          id: ids.completed,
          name: "Completed",
          status: TaskStatus.COMPLETED,
          dueOn: day("2026-11-01"),
        },
        { ...base, id: ids.dueToday, name: "Due today", dueOn: day(TODAY) },
        {
          ...base,
          id: ids.elsewhere,
          name: "Personal",
          workspaceId: adaPersonalWorkspaceId,
          dueOn: day("2026-11-01"),
        },
      ],
    });
  });

  afterAll(async () => {
    const workspaceIds = [
      workspaceId,
      adaPersonalWorkspaceId,
      bobPersonalWorkspaceId,
    ];
    await prisma.task.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: workspaceIds } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adaId, bobId] } } });
    await prisma.$disconnect();
  });

  it("moves only the caller's open overdue Tasks in the active workspace, then Undo puts back only untouched ones", async () => {
    const result = await call<Moved>("/due-dates/move-overdue", {
      today: TODAY,
      to: TO,
    });

    expect(result.moved.map((task) => [task.id, task.from])).toEqual([
      [ids.overdue, "2026-11-02"],
      [ids.assignedToAda, "2026-11-05"],
    ]);
    expect(result.skipped).toBe(0);
    expect(await dueOf(ids.overdue)).toBe(TO);
    expect(await dueOf(ids.assignedToAda)).toBe(TO);
    expect(await dueOf(ids.bobsOwn)).toBe("2026-11-05");
    expect(await dueOf(ids.completed)).toBe("2026-11-01");
    expect(await dueOf(ids.dueToday)).toBe(TODAY);
    expect(await dueOf(ids.elsewhere)).toBe("2026-11-01");

    // A teammate changes the date and then deliberately back to the same
    // day. The date matches, but the Task is no longer as the move left it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.task.update({
      where: { id: ids.overdue },
      data: { dueOn: day("2026-11-14") },
    });
    await prisma.task.update({
      where: { id: ids.overdue },
      data: { dueOn: day(TO) },
    });

    const undone = await call<{ restored: string[]; skipped: number }>(
      "/due-dates/undo",
      { to: TO, tasks: result.moved },
    );

    expect(undone).toEqual({ restored: [ids.assignedToAda], skipped: 1 });
    expect(await dueOf(ids.overdue)).toBe(TO);
    expect(await dueOf(ids.assignedToAda)).toBe("2026-11-05");

    // A second Undo of the same move changes nothing.
    expect(
      await call<{ restored: string[] }>("/due-dates/undo", {
        to: TO,
        tasks: result.moved,
      }),
    ).toEqual({ restored: [], skipped: 2 });
  });

  it("re-checks each selected Task under lock, so one finished or reassigned since keeps its day", async () => {
    await prisma.task.createMany({
      data: [
        {
          id: ids.laterFinished,
          name: "Finished meanwhile",
          workspaceId,
          ownerId: adaId,
          organizationId,
          dueOn: day("2026-11-03"),
        },
        {
          id: ids.laterReassigned,
          name: "Reassigned meanwhile",
          workspaceId,
          ownerId: bobId,
          assigneeUserId: adaId,
          organizationId,
          dueOn: day("2026-11-04"),
        },
      ],
    });
    // Both change after the selection, before the move locks them.
    beforeLock.current = async () => {
      await prisma.task.update({
        where: { id: ids.laterFinished },
        data: { status: TaskStatus.COMPLETED },
      });
      await prisma.task.update({
        where: { id: ids.laterReassigned },
        data: { assigneeUserId: bobId },
      });
    };

    const result = await call<Moved>("/due-dates/move-overdue", {
      today: TODAY,
      to: TO,
    });

    // The Task the first test put back is overdue again and still moves.
    expect(result.moved.map((task) => task.id)).toEqual([ids.assignedToAda]);
    expect(result.skipped).toBe(2);
    expect(await dueOf(ids.laterFinished)).toBe("2026-11-03");
    expect(await dueOf(ids.laterReassigned)).toBe("2026-11-04");
  });
});
