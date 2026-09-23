import { randomUUID } from "node:crypto";

import {
  type TaskSchedule,
  TaskScheduleEndsMode,
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

interface Store {
  schedules: TaskSchedule[];
  /** Coworkers that exist, keyed by id, with their vendor. */
  coworkers: Map<string, { vendorId: string }>;
  sokoBots: Map<string, { userId: string; workspaceId: string }>;
  projects: Map<string, { workspaceId: string }>;
  /** Organization members, as `${organizationId}:${userId}`. */
  members: Set<string>;
  vendorGrantStatus: VendorGrantStatus | null;
  seatAssigned: boolean;
}

function emptyStore(): Store {
  return {
    schedules: [],
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
    endsMode: TaskScheduleEndsMode.NEVER,
    endsOn: null,
    targetOccurrenceCount: null,
    releasedCount: 0,
    nextOccurrenceAt: new Date("2030-01-07T09:00:00.000Z"),
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

type Where = Record<string, unknown>;

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  if (expected !== null && typeof expected === "object") {
    const filter = expected as Record<string, unknown>;
    if ("not" in filter) return !matchesValue(actual, filter.not);
    if ("in" in filter) return (filter.in as unknown[]).includes(actual);
    throw new Error(`Unsupported filter ${JSON.stringify(expected)}`);
  }
  return actual === expected;
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
    return matchesValue(row[key as keyof TaskSchedule], expected);
  });
}

type Data = Record<string, unknown>;

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
        targetOccurrenceCount: null,
        releasedCount: 0,
        nextOccurrenceAt: null,
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

export const taskScheduleTestPrisma = {
  taskSchedule,
  /** Task Schedule routes must never write Tasks. */
  task: {
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
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
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        taskScheduleTestDb.projects.get(where.id)?.workspaceId ===
        where.workspaceId
          ? { id: where.id }
          : null,
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
  $transaction: vi.fn(
    async (fn: (tx: typeof taskScheduleTestPrisma) => Promise<unknown>) =>
      fn(taskScheduleTestPrisma),
  ),
};

/** Stand-in for the committed grant request a Coworker triggers. */
export async function requestPendingWorkspaceGrant() {
  return {
    grant: { id: "grant_1", status: "PENDING" as const },
    created: true,
  };
}
