import { randomUUID } from "node:crypto";

import {
  CalendarSourceType,
  type Task,
  type TaskEvent,
  type TaskSchedule,
  type TaskScheduleCreateOperation,
  TaskScheduleEndsMode,
  type TaskScheduleRun,
  TaskScheduleRunState,
  TaskScheduleState,
  TaskVisibility,
  type VendorGrantStatus,
} from "@sokosumi/database";
import { vi } from "vitest";

import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

/**
 * In-memory Prisma double for the `/tasks/schedules` route tests. Route files
 * mock `@/lib/db/prisma` with {@link taskScheduleTestPrisma} and seed
 * {@link taskScheduleTestDb}; assertions read rows back from the store.
 * Imports only types so the Prisma mock factory cannot import itself; the
 * Hono app helper lives in `task-schedule-app.ts`.
 */

export const ORG_ID = "org_123";
export const OWNER_ID = "user_owner";
export const MEMBER_ID = "user_member";
export const COWORKER_ID = "cow_123";
export const VENDOR_ID = "01960001-0001-7001-8001-000000000001";
export const SOKO_BOT_ID = "01960001-0001-7001-8001-000000000099";
export const PROJECT_ID = "01960001-0001-7001-8001-0000000000aa";
export const ORG_WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
export const PERSONAL_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

export const ORG_WORKSPACE = {
  workspaceId: ORG_WORKSPACE_ID,
  userId: null,
  organizationId: ORG_ID,
} satisfies WorkspaceVariables["workspaceContext"];

export const PERSONAL_WORKSPACE = {
  workspaceId: PERSONAL_WORKSPACE_ID,
  userId: OWNER_ID,
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

export function userAuth(userId: string = OWNER_ID): AuthenticationContext {
  return { actor: "user", userId, organizationId: ORG_ID, role: "user" };
}

export const COWORKER_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: VENDOR_ID,
  context: { userId: OWNER_ID, organizationId: ORG_ID },
};

export const SOKO_BOT_AUTH: AuthenticationContext = {
  actor: "sokoBot",
  sokoBotId: SOKO_BOT_ID,
  userId: OWNER_ID,
  organizationId: ORG_ID,
  workspaceId: ORG_WORKSPACE_ID,
};

type StoredTask = Partial<Task> & { id: string; events: Partial<TaskEvent>[] };

interface StoredProject {
  workspaceId: string;
  closingAt?: Date | null;
  closedAt?: Date | null;
}

interface Store {
  schedules: TaskSchedule[];
  runs: TaskScheduleRun[];
  createOperations: TaskScheduleCreateOperation[];
  /** Tasks the release created, with their nested events. */
  tasks: StoredTask[];
  /** Coworkers that exist, keyed by id, with their vendor. */
  coworkers: Map<string, { vendorId: string }>;
  sokoBots: Map<string, { userId: string; workspaceId: string }>;
  projects: Map<string, StoredProject>;
  /** Organization members, as `${organizationId}:${userId}`. */
  members: Set<string>;
  vendorGrantStatus: VendorGrantStatus | null;
  seatAssigned: boolean;
}

function emptyStore(): Store {
  return {
    schedules: [],
    runs: [],
    createOperations: [],
    tasks: [],
    coworkers: new Map([[COWORKER_ID, { vendorId: VENDOR_ID }]]),
    sokoBots: new Map([
      [SOKO_BOT_ID, { userId: OWNER_ID, workspaceId: ORG_WORKSPACE_ID }],
    ]),
    projects: new Map([[PROJECT_ID, { workspaceId: ORG_WORKSPACE_ID }]]),
    members: new Set([`${ORG_ID}:${OWNER_ID}`, `${ORG_ID}:${MEMBER_ID}`]),
    vendorGrantStatus: "GRANTED",
    seatAssigned: true,
  };
}

export const taskScheduleTestDb: Store = emptyStore();

export function resetTaskScheduleTestDb(): void {
  Object.assign(taskScheduleTestDb, emptyStore());
  vi.clearAllMocks();
}

export function seedTaskSchedule(
  overrides: Partial<TaskSchedule> = {},
): TaskSchedule {
  const now = new Date("2026-09-01T08:00:00.000Z");
  const row: TaskSchedule = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    workspaceId: ORG_WORKSPACE_ID,
    organizationId: ORG_ID,
    ownerId: OWNER_ID,
    creatorUserId: OWNER_ID,
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state: TaskScheduleState.ACTIVE,
    expr: "0 9 * * 1",
    timezone: "UTC",
    intervalDays: null,
    anchorAt: now,
    ruleEffectiveFrom: now,
    epochId: randomUUID(),
    endsMode: TaskScheduleEndsMode.NEVER,
    endsOn: null,
    targetRunCount: null,
    releasedCount: 0,
    nextRunAt: new Date("2030-01-07T09:00:00.000Z"),
    revision: 0,
    name: "Weekly report",
    description: null,
    projectId: null,
    visibility: TaskVisibility.PUBLIC,
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    ...overrides,
  };
  taskScheduleTestDb.schedules.push(row);
  return row;
}

/** A Task as the Run at release reads it, with no events yet. */
export function seedTask(overrides: Partial<Task> = {}): StoredTask {
  const row: StoredTask = {
    id: randomUUID(),
    ownerId: OWNER_ID,
    workspaceId: ORG_WORKSPACE_ID,
    organizationId: ORG_ID,
    assigneeId: COWORKER_ID,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    archivedAt: null,
    runAt: null,
    ...overrides,
    events: [],
  };
  taskScheduleTestDb.tasks.push(row);
  return row;
}

/** Changes a stored Task the way a concurrent request would. */
export function seedTaskUpdate(id: string, data: Partial<Task>): void {
  taskScheduleTestDb.tasks = taskScheduleTestDb.tasks.map((row) =>
    row.id === id ? { ...row, ...data } : row,
  );
}

/** A ledger row of `schedule` in its current epoch, planned at `at`. */
export function seedRun(
  schedule: TaskSchedule,
  at: Date,
  overrides: Partial<TaskScheduleRun> = {},
): TaskScheduleRun {
  const row: TaskScheduleRun = {
    id: randomUUID(),
    createdAt: at,
    updatedAt: at,
    scheduleId: schedule.id,
    releasedTaskId: null,
    epochId: schedule.epochId,
    originalScheduledAt: at,
    effectiveScheduledAt: at,
    state: TaskScheduleRunState.PLANNED,
    sourceWorkspaceId: schedule.workspaceId,
    sourceType: schedule.projectId
      ? CalendarSourceType.PROJECT
      : CalendarSourceType.WORKSPACE,
    sourceProjectId: schedule.projectId,
    actorUserId: null,
    actorCoworkerId: null,
    timezone: schedule.timezone,
    ...overrides,
  };
  taskScheduleTestDb.runs.push(row);
  return row;
}

/** Ledger rows of a schedule, oldest first. */
export function runsOf(scheduleId: string): TaskScheduleRun[] {
  return sortRuns(
    taskScheduleTestDb.runs.filter((row) => row.scheduleId === scheduleId),
  );
}

type Where = Record<string, unknown>;

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  if (expected !== null && typeof expected === "object") {
    // Prisma ignores undefined operators; an empty filter matches any row.
    const filter = Object.fromEntries(
      Object.entries(expected).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(filter).length === 0) return true;
    // SQL semantics: `col <> x` is never true for a NULL column.
    if ("not" in filter) {
      return actual != null && !matchesValue(actual, filter.not);
    }
    if ("in" in filter) return (filter.in as unknown[]).includes(actual);
    if ("notIn" in filter) {
      return actual != null && !(filter.notIn as unknown[]).includes(actual);
    }
    if (
      "lte" in filter ||
      "lt" in filter ||
      "gte" in filter ||
      "gt" in filter
    ) {
      if (!(actual instanceof Date)) return false;
      const time = actual.getTime();
      const bound = (key: string) => (filter[key] as Date).getTime();
      return (
        (!("lte" in filter) || time <= bound("lte")) &&
        (!("lt" in filter) || time < bound("lt")) &&
        (!("gte" in filter) || time >= bound("gte")) &&
        (!("gt" in filter) || time > bound("gt"))
      );
    }
    throw new Error(`Unsupported filter ${JSON.stringify(expected)}`);
  }
  return actual === expected;
}

function matchesRow<Row extends object>(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === "OR") {
      return (expected as Where[]).some((branch) => matchesRow(row, branch));
    }
    if (key === "AND") {
      return (expected as Where[]).every((branch) => matchesRow(row, branch));
    }
    return matchesValue(row[key as keyof Row], expected);
  });
}

function sortRuns(rows: TaskScheduleRun[]): TaskScheduleRun[] {
  return [...rows].sort(
    (a, b) =>
      a.effectiveScheduledAt.getTime() - b.effectiveScheduledAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

function matchesSchedule(row: TaskSchedule, where: Where = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === "OR") {
      return (expected as Where[]).some((branch) =>
        matchesSchedule(row, branch),
      );
    }
    if (key === "AND") {
      return (expected as Where[]).every((branch) =>
        matchesSchedule(row, branch),
      );
    }
    if (key === "assignee") {
      const assignee = row.assigneeId
        ? taskScheduleTestDb.coworkers.get(row.assigneeId)
        : undefined;
      if (!assignee) return false;
      return Object.entries(expected as Where).every(([field, value]) =>
        matchesValue(assignee[field as keyof typeof assignee], value),
      );
    }
    if (key === "project") {
      const project = row.projectId
        ? taskScheduleTestDb.projects.get(row.projectId)
        : undefined;
      if (!project) return false;
      return matchesRow(
        { closingAt: null, closedAt: null, ...project },
        expected as Where,
      );
    }
    return matchesValue(row[key as keyof TaskSchedule], expected);
  });
}

type Data = Record<string, unknown>;

/** What Prisma throws when a unique constraint rejects a write. */
function uniqueConstraintError(target: string[]): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target },
  });
}

function applyData(row: TaskSchedule, data: Data): TaskSchedule {
  const next = { ...row, updatedAt: new Date() } as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object" && "increment" in value) {
      next[key] = (next[key] as number) + (value.increment as number);
      continue;
    }
    next[key] = value;
  }
  return next as unknown as TaskSchedule;
}

function withInclude(row: TaskSchedule, include?: Record<string, unknown>) {
  if (!include?.assignee) return row;
  const assignee = row.assigneeId
    ? (taskScheduleTestDb.coworkers.get(row.assigneeId) ?? null)
    : null;
  return { ...row, assignee };
}

function sortSchedules(rows: TaskSchedule[]): TaskSchedule[] {
  return [...rows].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
}

const taskSchedule = {
  create: vi.fn(async ({ data }: { data: Data }) => {
    const now = new Date();
    const row = applyData(
      {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        organizationId: null,
        creatorUserId: null,
        creatorCoworkerId: null,
        creatorSokoBotId: null,
        state: TaskScheduleState.ACTIVE,
        intervalDays: null,
        endsMode: TaskScheduleEndsMode.NEVER,
        endsOn: null,
        targetRunCount: null,
        releasedCount: 0,
        nextRunAt: null,
        revision: 0,
        description: null,
        projectId: null,
        visibility: TaskVisibility.PUBLIC,
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
      } as unknown as TaskSchedule,
      data,
    );
    taskScheduleTestDb.schedules.push(row);
    return row;
  }),
  findFirst: vi.fn(
    async ({
      where,
      include,
    }: {
      where: Where;
      include?: Record<string, unknown>;
    }) => {
      const row = taskScheduleTestDb.schedules.find((candidate) =>
        matchesSchedule(candidate, where),
      );
      return row ? withInclude(row, include) : null;
    },
  ),
  findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
    const row = taskScheduleTestDb.schedules.find((r) => r.id === where.id);
    if (!row) throw new Error(`No TaskSchedule ${where.id}`);
    return row;
  }),
  findMany: vi.fn(
    async ({
      where,
      take,
      skip,
      cursor,
    }: {
      where: Where;
      take?: number;
      skip?: number;
      cursor?: { id: string };
    }) => {
      let rows = sortSchedules(
        taskScheduleTestDb.schedules.filter((row) =>
          matchesSchedule(row, where),
        ),
      );
      if (cursor) {
        const index = rows.findIndex((row) => row.id === cursor.id);
        rows = rows.slice(index + (skip ?? 0));
      }
      return rows.slice(0, take ?? rows.length);
    },
  ),
  count: vi.fn(
    async ({ where }: { where: Where }) =>
      taskScheduleTestDb.schedules.filter((row) => matchesSchedule(row, where))
        .length,
  ),
  update: vi.fn(
    async ({ where, data }: { where: { id: string }; data: Data }) => {
      const row = taskScheduleTestDb.schedules.find((r) => r.id === where.id);
      if (!row) throw new Error(`No TaskSchedule ${where.id}`);
      const updated = applyData(row, data);
      taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.map((r) =>
        r.id === where.id ? updated : r,
      );
      return updated;
    },
  ),
  updateMany: vi.fn(async ({ where, data }: { where: Where; data: Data }) => {
    let count = 0;
    taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.map((row) => {
      if (!matchesSchedule(row, where)) return row;
      count += 1;
      return applyData(row, data);
    });
    return { count };
  }),
  delete: vi.fn(async ({ where }: { where: { id: string } }) => {
    const row = taskScheduleTestDb.schedules.find((r) => r.id === where.id);
    if (!row) throw new Error(`No TaskSchedule ${where.id}`);
    taskScheduleTestDb.schedules = taskScheduleTestDb.schedules.filter(
      (r) => r.id !== where.id,
    );
    return row;
  }),
};

function runKey(row: Partial<TaskScheduleRun>): string {
  return `${row.scheduleId}:${row.epochId}:${row.originalScheduledAt?.toISOString()}`;
}

const taskScheduleRun = {
  count: vi.fn(
    async ({ where }: { where: Where }) =>
      taskScheduleTestDb.runs.filter((row) => matchesRow(row, where)).length,
  ),
  /** Sorts by effective time, or latest rule time first when asked. */
  findMany: vi.fn(
    async ({
      where,
      take,
      skip,
      cursor,
      orderBy,
    }: {
      where: Where;
      take?: number;
      skip?: number;
      cursor?: { id: string };
      orderBy?: Record<string, "asc" | "desc">[];
    }) => {
      let rows = sortRuns(
        taskScheduleTestDb.runs.filter((row) => matchesRow(row, where)),
      );
      if (orderBy?.[0]?.originalScheduledAt === "desc") {
        rows.sort(
          (a, b) =>
            (b.originalScheduledAt?.getTime() ?? 0) -
            (a.originalScheduledAt?.getTime() ?? 0),
        );
      }
      if (cursor) {
        const index = rows.findIndex((row) => row.id === cursor.id);
        rows = rows.slice(index + (skip ?? 0));
      }
      return rows.slice(0, take);
    },
  ),
  findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
    const row = taskScheduleTestDb.runs.find((r) => r.id === where.id);
    if (!row) throw new Error(`No TaskScheduleRun ${where.id}`);
    return row;
  }),
  findFirst: vi.fn(
    async (args: {
      where: Where;
      orderBy?: Record<string, "asc" | "desc">[];
    }): Promise<TaskScheduleRun | null> =>
      (await taskScheduleRun.findMany(args))[0] ?? null,
  ),
  /** Enforces the (scheduleId, epochId, originalScheduledAt) unique key. */
  createMany: vi.fn(
    async ({
      data,
      skipDuplicates,
    }: {
      data: Partial<TaskScheduleRun>[];
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const input of data) {
        const key = runKey(input);
        if (taskScheduleTestDb.runs.some((row) => runKey(row) === key)) {
          if (skipDuplicates) continue;
          throw new Error(`Duplicate Run ${key}`);
        }
        const now = new Date();
        taskScheduleTestDb.runs.push({
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          releasedTaskId: null,
          sourceProjectId: null,
          actorUserId: null,
          actorCoworkerId: null,
          ...input,
        } as TaskScheduleRun);
        count += 1;
      }
      return { count };
    },
  ),
  updateMany: vi.fn(async ({ where, data }: { where: Where; data: Data }) => {
    let count = 0;
    taskScheduleTestDb.runs = taskScheduleTestDb.runs.map((row) => {
      if (!matchesRow(row, where)) return row;
      count += 1;
      return { ...row, ...data, updatedAt: new Date() };
    });
    return { count };
  }),
  deleteMany: vi.fn(async ({ where }: { where: Where }) => {
    const before = taskScheduleTestDb.runs.length;
    taskScheduleTestDb.runs = taskScheduleTestDb.runs.filter(
      (row) => !matchesRow(row, where),
    );
    return { count: before - taskScheduleTestDb.runs.length };
  }),
};

export const taskScheduleTestPrisma = {
  /** Calendar scope locks: every locked row exists. */
  $queryRaw: vi.fn(async () => [{ id: "locked" }]),
  taskSchedule,
  taskScheduleRun,
  taskScheduleCreateOperation: {
    findUnique: vi.fn(
      async ({
        where: { workspaceId_operationId: key },
      }: {
        where: {
          workspaceId_operationId: { workspaceId: string; operationId: string };
        };
      }) => {
        const row = taskScheduleTestDb.createOperations.find(
          (operation) =>
            operation.workspaceId === key.workspaceId &&
            operation.operationId === key.operationId,
        );
        return row
          ? {
              ...row,
              schedule: taskScheduleTestDb.schedules.find(
                (schedule) => schedule.id === row.scheduleId,
              ),
            }
          : null;
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<TaskScheduleCreateOperation, "id" | "createdAt">;
      }) => {
        if (
          taskScheduleTestDb.createOperations.some(
            (row) =>
              row.workspaceId === data.workspaceId &&
              row.operationId === data.operationId,
          )
        ) {
          throw uniqueConstraintError(["workspaceId", "operationId"]);
        }
        const row = { id: randomUUID(), createdAt: new Date(), ...data };
        taskScheduleTestDb.createOperations.push(row);
        return row;
      },
    ),
  },
  /** Only the releases write Tasks; routes must never write them. */
  task: {
    create: vi.fn(
      async ({
        data: { events, ...data },
      }: {
        data: Partial<Task> & { events?: { create: Partial<TaskEvent> } };
      }) => {
        const row: StoredTask = {
          id: randomUUID(),
          ...data,
          events: events ? [events.create] : [],
        };
        taskScheduleTestDb.tasks.push(row);
        return row;
      },
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        taskScheduleTestDb.tasks.find((row) => row.id === where.id) ?? null,
    ),
    findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
      taskScheduleTestDb.tasks
        .filter((row) => matchesRow(row, where))
        .slice(0, take),
    ),
    update: vi.fn(),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Data }) => {
      let count = 0;
      taskScheduleTestDb.tasks = taskScheduleTestDb.tasks.map((row) => {
        if (!matchesRow(row, where)) return row;
        count += 1;
        return { ...row, ...data };
      });
      return { count };
    }),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  taskEvent: {
    create: vi.fn(async ({ data }: { data: Partial<TaskEvent> }) => {
      taskScheduleTestDb.tasks = taskScheduleTestDb.tasks.map((row) =>
        row.id === data.taskId
          ? { ...row, events: [...row.events, data] }
          : row,
      );
      return { id: randomUUID(), ...data };
    }),
  },
  coworker: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      taskScheduleTestDb.coworkers.has(where.id)
        ? { id: where.id, slug: where.id, baseURL: null }
        : null,
    ),
  },
  sokoBot: {
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const bot = taskScheduleTestDb.sokoBots.get(where.id);
        return bot && bot.workspaceId === where.workspaceId
          ? { id: where.id, userId: bot.userId }
          : null;
      },
    ),
  },
  project: {
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const project = taskScheduleTestDb.projects.get(where.id);
        return project?.workspaceId === where.workspaceId
          ? {
              id: where.id,
              closingAt: project.closingAt ?? null,
              closedAt: project.closedAt ?? null,
            }
          : null;
      },
    ),
  },
  workspace: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === ORG_WORKSPACE_ID) {
        return { userId: null, organizationId: ORG_ID };
      }
      if (where.id === PERSONAL_WORKSPACE_ID) {
        return { userId: OWNER_ID, organizationId: null };
      }
      return null;
    }),
  },
  member: {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { organizationId: string; userId: string };
      }) =>
        taskScheduleTestDb.members.has(
          `${where.organizationId}:${where.userId}`,
        )
          ? { id: `member_${where.userId}` }
          : null,
    ),
  },
  vendorGrant: {
    findUnique: vi.fn(async () =>
      taskScheduleTestDb.vendorGrantStatus
        ? {
            id: "grant_1",
            status: taskScheduleTestDb.vendorGrantStatus,
            permission: "workspace",
          }
        : null,
    ),
  },
  /** Rolls the rows back when the callback throws, as Postgres would. */
  $transaction: vi.fn(
    async (fn: (tx: typeof taskScheduleTestPrisma) => Promise<unknown>) => {
      // Rows are replaced, never mutated, so copying the arrays is a snapshot.
      const schedules = [...taskScheduleTestDb.schedules];
      const runs = [...taskScheduleTestDb.runs];
      const tasks = [...taskScheduleTestDb.tasks];
      const createOperations = [...taskScheduleTestDb.createOperations];
      try {
        return await fn(taskScheduleTestPrisma);
      } catch (error) {
        Object.assign(taskScheduleTestDb, {
          schedules,
          runs,
          tasks,
          createOperations,
        });
        throw error;
      }
    },
  ),
};

/** Stand-in for the committed grant request a Coworker triggers. */
export async function requestPendingWorkspaceGrant() {
  return {
    grant: { id: "grant_1", status: "PENDING" as const },
    created: true,
  };
}
