import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { MAX_DUE_DATE_MOVES } from "../each-locked-task";
import mountShiftProject from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
const otherProjectId = randomUUID();
const bigProjectId = randomUUID();

const ids = {
  first: randomUUID(),
  second: randomUUID(),
  completed: randomUUID(),
  canceled: randomUUID(),
  grantPending: randomUUID(),
  archived: randomUUID(),
  undated: randomUUID(),
  bobsPrivate: randomUUID(),
  otherProject: randomUUID(),
};

interface Shifted {
  tasks: Array<{ id: string; name: string; from: string; to: string }>;
  skipped: number;
  overLimit: boolean;
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: adaId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    await next();
  });
  app.onError(errorHandler);
  mountShiftProject(app);
  return app;
}

async function shift(body: unknown): Promise<Shifted> {
  const response = await createApp().request(
    "http://localhost/due-dates/shift-project",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = (await response.json()) as { data: Shifted };
  expect(response.status, JSON.stringify(json)).toBe(200);
  return json.data;
}

/** What the dialog sends back on Confirm: the previewed Tasks and their days. */
function confirmed(preview: Shifted) {
  return preview.tasks.map(({ id, from }) => ({ id, from }));
}

async function dueOf(id: string): Promise<string | undefined> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id } });
  return task.dueOn?.toISOString().slice(0, 10);
}

// Real Prisma against migrations: the eligibility predicate, the locked
// recheck and the boundary between the preview and Confirm.
describe.skipIf(!enabled)("moving a project's due dates", () => {
  const base = {
    workspaceId,
    projectId,
    ownerId: adaId,
    organizationId,
    status: TaskStatus.DRAFT,
    visibility: TaskVisibility.PUBLIC,
  };

  beforeAll(async () => {
    for (const id of [adaId, bobId]) {
      await prisma.user.create({
        data: {
          id,
          name: "Shift fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: randomUUID() } },
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
    await prisma.project.createMany({
      data: [
        { id: projectId, workspaceId, name: "Launch" },
        { id: otherProjectId, workspaceId, name: "Other" },
        { id: bigProjectId, workspaceId, name: "Big" },
      ],
    });
    await prisma.task.createMany({
      data: [
        { ...base, id: ids.first, name: "First", dueOn: day("2026-11-20") },
        { ...base, id: ids.second, name: "Second", dueOn: day("2026-12-01") },
        {
          ...base,
          id: ids.completed,
          name: "Completed",
          status: TaskStatus.COMPLETED,
          dueOn: day("2026-11-21"),
        },
        {
          ...base,
          id: ids.canceled,
          name: "Canceled",
          status: TaskStatus.CANCELED,
          dueOn: day("2026-11-21"),
        },
        {
          ...base,
          id: ids.grantPending,
          name: "Waiting on a grant",
          status: TaskStatus.GRANT_PENDING,
          dueOn: day("2026-11-21"),
        },
        {
          ...base,
          id: ids.archived,
          name: "Archived",
          archivedAt: new Date(),
          dueOn: day("2026-11-21"),
        },
        { ...base, id: ids.undated, name: "No date", dueOn: null },
        {
          ...base,
          id: ids.bobsPrivate,
          name: "Bob's private",
          ownerId: bobId,
          visibility: TaskVisibility.PRIVATE,
          dueOn: day("2026-11-21"),
        },
        {
          ...base,
          id: ids.otherProject,
          name: "Other project",
          projectId: otherProjectId,
          dueOn: day("2026-11-21"),
        },
        ...Array.from({ length: MAX_DUE_DATE_MOVES + 1 }, (_, index) => ({
          ...base,
          id: randomUUID(),
          name: `Big ${index}`,
          projectId: bigProjectId,
          dueOn: day("2026-11-21"),
        })),
      ],
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({
      where: {
        OR: [{ id: workspaceId }, { userId: { in: [adaId, bobId] } }],
      },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adaId, bobId] } } });
    await prisma.$disconnect();
  });

  it("previews only the project's open, dated Tasks the caller may edit", async () => {
    const preview = await shift({ projectId, days: 7 });

    expect(preview).toEqual({
      tasks: [
        { id: ids.first, name: "First", from: "2026-11-20", to: "2026-11-27" },
        {
          id: ids.second,
          name: "Second",
          from: "2026-12-01",
          to: "2026-12-08",
        },
      ],
      skipped: 0,
      overLimit: false,
    });
    expect(await dueOf(ids.first)).toBe("2026-11-20");
  });

  it("flags a project over the limit from the same list it shows", async () => {
    const preview = await shift({ projectId: bigProjectId, days: 7 });

    expect(preview.overLimit).toBe(true);
    expect(preview.tasks).toHaveLength(MAX_DUE_DATE_MOVES);
  });

  it("moves only the confirmed Tasks from the days they were shown on", async () => {
    const preview = await shift({ projectId, days: 7 });

    // Between the preview and Confirm a teammate re-dates the first Task and
    // adds a new one. Neither was confirmed, so neither moves.
    await prisma.task.update({
      where: { id: ids.first },
      data: { dueOn: day("2026-11-25") },
    });
    const added = randomUUID();
    await prisma.task.create({
      data: { ...base, id: added, name: "Added", dueOn: day("2026-11-22") },
    });

    const result = await shift({
      projectId,
      days: 7,
      tasks: confirmed(preview),
    });

    expect(result.tasks.map((task) => [task.id, task.to])).toEqual([
      [ids.second, "2026-12-08"],
    ]);
    expect(result.skipped).toBe(1);
    expect(await dueOf(ids.first)).toBe("2026-11-25");
    expect(await dueOf(ids.second)).toBe("2026-12-08");
    expect(await dueOf(added)).toBe("2026-11-22");

    await prisma.task.delete({ where: { id: added } });
  });

  it("moves each Task once when the same Confirm arrives twice at once", async () => {
    const preview = await shift({ projectId, days: -2 });
    const plan = { projectId, days: -2, tasks: confirmed(preview) };

    const [one, two] = await Promise.all([shift(plan), shift(plan)]);

    expect(one.tasks.length + two.tasks.length).toBe(preview.tasks.length);
    expect(one.skipped + two.skipped).toBe(preview.tasks.length);
    for (const task of preview.tasks) {
      expect(await dueOf(task.id)).toBe(task.to);
    }
  });

  it("skips a confirmed Task that is no longer eligible", async () => {
    const result = await shift({
      projectId,
      days: 7,
      tasks: [
        { id: ids.completed, from: "2026-11-21" },
        { id: ids.otherProject, from: "2026-11-21" },
        { id: ids.bobsPrivate, from: "2026-11-21" },
      ],
    });

    expect(result).toEqual({ tasks: [], skipped: 3, overLimit: false });
    expect(await dueOf(ids.completed)).toBe("2026-11-21");
    expect(await dueOf(ids.otherProject)).toBe("2026-11-21");
    expect(await dueOf(ids.bobsPrivate)).toBe("2026-11-21");
  });
});
