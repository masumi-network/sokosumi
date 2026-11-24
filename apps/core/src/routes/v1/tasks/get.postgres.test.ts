import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTasks from "./get";

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

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const adaPersonalWorkspaceId = randomUUID();
const bobPersonalWorkspaceId = randomUUID();

const TODAY = "2026-11-10";
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

// Home's My day: Ada's open Tasks due by today, owned or assigned to her.
const matching = [
  { name: "Due 1", ownerId: adaId, dueOn: "2026-11-01" },
  // A teammate's public Task assigned to Ada.
  {
    name: "Due 2",
    ownerId: bobId,
    assigneeUserId: adaId,
    dueOn: "2026-11-02",
    status: TaskStatus.RUNNING,
  },
  {
    name: "Due 3",
    ownerId: adaId,
    dueOn: "2026-11-03",
    status: TaskStatus.DRAFT,
  },
  {
    name: "Due 4",
    ownerId: adaId,
    dueOn: "2026-11-04",
    status: TaskStatus.FAILED,
  },
  { name: "Due 5", ownerId: adaId, dueOn: "2026-11-05" },
  { name: "Due 6", ownerId: adaId, dueOn: TODAY },
];

const unrelated = [
  { name: "Due tomorrow", ownerId: adaId, dueOn: "2026-11-11" },
  {
    name: "Completed",
    ownerId: adaId,
    dueOn: "2026-11-01",
    status: TaskStatus.COMPLETED,
  },
  {
    name: "Canceled",
    ownerId: adaId,
    dueOn: "2026-11-01",
    status: TaskStatus.CANCELED,
  },
  { name: "No due date", ownerId: adaId, dueOn: null },
  { name: "No due date either", ownerId: adaId, dueOn: null },
  {
    name: "Archived",
    ownerId: adaId,
    dueOn: "2026-11-01",
    archivedAt: new Date(),
  },
  { name: "Bob's own", ownerId: bobId, dueOn: "2026-11-01" },
  {
    name: "Bob's private, assigned to Ada",
    ownerId: bobId,
    assigneeUserId: adaId,
    dueOn: "2026-11-01",
    visibility: TaskVisibility.PRIVATE,
  },
  {
    name: "Other workspace",
    ownerId: adaId,
    dueOn: "2026-11-01",
    workspaceId: adaPersonalWorkspaceId,
  },
];

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
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTasks(app);
  return app;
}

interface Page {
  data: Array<{
    name: string;
    resultMatch?: string;
    openSubtasks?: Array<{ name: string; status: string }>;
    subtaskProgress: { completed: number; total: number };
  }>;
  meta: { pagination: { total: number; nextCursor: string | null } };
}

async function dueOnPage(limit: number, cursor?: string): Promise<Page> {
  const params = new URLSearchParams({
    scope: "mine",
    sort: "dueOn",
    status: TaskStatus.READY,
    limit: String(limit),
    ...(cursor ? { cursor } : {}),
  });
  const response = await createApp().request(`http://localhost/?${params}`);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as Page;
}

async function myDayPage(cursor?: string): Promise<Page> {
  const params = new URLSearchParams({
    scope: "mine",
    dueOnTo: TODAY,
    sort: "dueOn",
    status: Object.values(TaskStatus)
      .filter(
        (status) =>
          status !== TaskStatus.COMPLETED &&
          status !== TaskStatus.CANCELED &&
          status !== TaskStatus.CREATED,
      )
      .join(","),
    limit: "5",
    ...(cursor ? { cursor } : {}),
  });
  const response = await createApp().request(`http://localhost/?${params}`);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as Page;
}

// Real Prisma, migrations, date column and cursor pagination.
describe.skipIf(!enabled)("GET /tasks for Home's My day", () => {
  beforeAll(async () => {
    for (const [id, personalWorkspaceId] of [
      [adaId, adaPersonalWorkspaceId],
      [bobId, bobPersonalWorkspaceId],
    ]) {
      await prisma.user.create({
        data: {
          id,
          name: "My day fixture",
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
            { userId: bobId, role: "member" },
          ],
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.task.createMany({
      data: [...matching, ...unrelated].map(({ dueOn, ...task }) => ({
        workspaceId,
        status: TaskStatus.READY,
        ...task,
        dueOn: dueOn ? day(dueOn) : null,
      })),
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

  it("ranks name and identifier matches ahead of tags and descriptions, then results, across pages", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Search fixture", identifier: "FIND" },
    });
    const label = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: "TAG",
        displayName: "50%_launch",
        normalizedName: "50%_launch",
      },
    });
    const taskDefaults = {
      workspaceId,
      projectId: project.id,
      ownerId: adaId,
      status: TaskStatus.FAILED,
    };
    const named = await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "50%_launch announcement",
        description: "50%_launch",
        createdAt: day("2026-01-01"),
      },
    });
    await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "Tagged",
        workspaceTags: { create: { labelId: label.id } },
      },
    });
    await prisma.task.createMany({
      data: [
        {
          name: "Brief only",
          description: "50%_LAUNCH",
          createdAt: day("2026-01-02"),
        },
        { name: "50 other launch", description: "wildcards must be literal" },
        {
          name: "50%_launch private",
          visibility: TaskVisibility.PRIVATE,
          ownerId: bobId,
        },
      ].map((task) => ({ ...taskDefaults, ...task })),
    });

    await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "Quarterly report",
        createdAt: day("2026-01-03"),
        status: TaskStatus.COMPLETED,
        events: {
          create: [
            { comment: "Draft mentions 50%_launch in passing" },
            {
              status: TaskStatus.COMPLETED,
              comment:
                "Intro.\n\n## Pricing\nThe **50%_launch** plan costs 20.",
            },
          ],
        },
      },
    });
    // Two results at the same moment: the later id is the latest.
    const [olderId, newerId] = [randomUUID(), randomUUID()].sort();
    const at = new Date("2026-01-05T00:00:00.000Z");
    await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "Supplier notes",
        createdAt: day("2026-01-04"),
        status: TaskStatus.COMPLETED,
        events: {
          create: [
            {
              id: newerId,
              createdAt: at,
              status: TaskStatus.COMPLETED,
              comment: "Newer: 50%_launch",
            },
            {
              id: olderId,
              createdAt: at,
              status: TaskStatus.COMPLETED,
              comment: "Older: 50%_launch",
            },
          ],
        },
      },
    });
    // Only a plain comment mentions it, which is not a result.
    await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "Discussion",
        events: { create: { comment: "What about 50%_launch?" } },
      },
    });
    await prisma.task.create({
      data: {
        ...taskDefaults,
        name: "Bob's private report",
        visibility: TaskVisibility.PRIVATE,
        ownerId: bobId,
        status: TaskStatus.COMPLETED,
        events: {
          create: { status: TaskStatus.COMPLETED, comment: "50%_launch" },
        },
      },
    });

    async function searchPages(search: string, limit: number) {
      const params = new URLSearchParams({
        scope: "workspace",
        projectId: project.id,
        search,
        limit: String(limit),
      });
      const names: string[] = [];
      const matches: Record<string, string> = {};
      let total = 0;
      do {
        const response = await createApp().request(
          `http://localhost/?${params}`,
        );
        const body = (await response.json()) as Page;
        expect(response.status, JSON.stringify(body)).toBe(200);
        names.push(...body.data.map(({ name }) => name));
        for (const { name, resultMatch } of body.data)
          if (resultMatch) matches[name] = resultMatch;
        total = body.meta.pagination.total;
        if (!body.meta.pagination.nextCursor) break;
        params.set("cursor", body.meta.pagination.nextCursor);
      } while (names.length <= total);
      return { names, total, matches };
    }

    const expected = {
      names: [
        named.name,
        "Tagged",
        "Brief only",
        "Supplier notes",
        "Quarterly report",
      ],
      total: 5,
      matches: {
        "Supplier notes": "Newer: 50%_launch",
        "Quarterly report": "Intro. Pricing The 50%_launch plan costs 20.",
      },
    };
    for (const limit of [1, 2, 3, 4])
      expect(await searchPages("50%_launch", limit)).toEqual(expected);
    expect(await searchPages(`find-${named.number}`, 2)).toEqual({
      names: [named.name],
      total: 1,
      matches: {},
    });
  });

  it("pages through exactly the six matching Tasks, earliest due first", async () => {
    const first = await myDayPage();

    expect(first.data.map((task) => task.name)).toEqual([
      "Due 1",
      "Due 2",
      "Due 3",
      "Due 4",
      "Due 5",
    ]);
    expect(first.meta.pagination.total).toBe(6);
    expect(first.meta.pagination.nextCursor).not.toBeNull();

    const second = await myDayPage(first.meta.pagination.nextCursor ?? "");

    expect(second.data.map((task) => task.name)).toEqual(["Due 6"]);
    expect(second.meta.pagination.total).toBe(6);
    expect(second.meta.pagination.nextCursor).toBeNull();
  });

  it("names a parent's first three open sub-tasks in sub-task order", async () => {
    const parent = await prisma.task.create({
      data: {
        workspaceId,
        ownerId: adaId,
        name: "Parent with steps",
        // Not READY and no due day, so the other lists here never show it.
        status: TaskStatus.RUNNING,
      },
    });
    await prisma.task.createMany({
      data: [
        { name: "C", position: 3 },
        { name: "A", position: 1 },
        { name: "B done", position: 2, status: TaskStatus.COMPLETED },
        { name: "D", position: 4 },
        { name: "E", position: 5 },
        { name: "Archived", position: 0.5, archivedAt: new Date() },
      ].map((subtask) => ({
        workspaceId,
        ownerId: adaId,
        parentTaskId: parent.id,
        status: TaskStatus.READY,
        ...subtask,
      })),
    });

    const params = new URLSearchParams({
      scope: "mine",
      q: "Parent with steps",
    });
    const response = await createApp().request(`http://localhost/?${params}`);
    const body = (await response.json()) as Page;

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data.map((task) => task.name)).toEqual(["Parent with steps"]);
    expect(body.data[0]?.subtaskProgress).toEqual({ completed: 1, total: 5 });
    expect(body.data[0]?.openSubtasks?.map((task) => task.name)).toEqual([
      "A",
      "C",
      "D",
    ]);
  });

  // Sort by Due date on the Tasks board pages past the dated Tasks into the
  // ones without a due day, which sort last.
  it("pages a dueOn sort into the Tasks without a due day", async () => {
    const all = (await dueOnPage(100)).data.map((task) => task.name);
    // Two undated Tasks, so one page's cursor sits on an undated row.
    expect(all.slice(-2).sort()).toEqual(["No due date", "No due date either"]);

    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await dueOnPage(2, cursor);
      paged.push(...page.data.map((task) => task.name));
      cursor = page.meta.pagination.nextCursor ?? undefined;
    } while (cursor && paged.length <= all.length);

    expect(paged).toEqual(all);
  });
});
