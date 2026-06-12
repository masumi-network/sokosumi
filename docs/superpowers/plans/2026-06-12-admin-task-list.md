# Admin Task List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable admin task list (SOK-566): a Core admin endpoint listing all tasks searchable by task ID, task name, user, or organization, surfaced as an admin web page.

**Architecture:** Web → Core split. New `GET /v1/admin/tasks` Core route (admin-gated, direct Prisma like `/v1/tasks`), consumed by the web app through the regenerated Core client, a web service (`admin-task.service.ts`), a server action (`listAdminTasksAction`), and a client list component with debounced search + cursor "load more". Mirrors the admin user overview (SOK-565, commit `2d058c9f8`) end to end.

**Tech Stack:** Hono + zod-openapi (core), Prisma, Next.js App Router + next-intl + shadcn (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-admin-task-list-design.md`

---

### Task 1: Core — admin task list schema, route, mount (TDD)

**Files:**
- Test: `apps/core/src/routes/v1/admin/admin-task-list.routes.test.ts` (create)
- Modify: `apps/core/src/schemas/admin.schema.ts`
- Create: `apps/core/src/routes/v1/admin/tasks/get.ts`
- Create: `apps/core/src/routes/v1/admin/tasks/index.ts`
- Modify: `apps/core/src/routes/v1/admin/index.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/core/src/routes/v1/admin/admin-task-list.routes.test.ts` (the `createApp` helper is copied from `admin-user-overview.routes.test.ts` in the same directory — it wires auth context + the admin gate the same way the real admin router does):

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const { taskFindManyMock, taskCountMock, transactionMock } = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    task: { findMany: taskFindManyMock, count: taskCountMock },
  },
}));

const { default: mountListAdminTasks } = await import("./tasks/get.js");

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  options: AppOptions = {},
) {
  const { role = "admin", actor = "user" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", { actor: "coworker", coworkerId: "cow_123" });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role,
      });
    }

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountRoutes(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    name: "Quarterly report",
    status: "RUNNING",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
    organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
    ...overrides,
  };
}

describe("GET /v1/admin/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (operations: unknown[]) =>
      Promise.all(operations),
    );
    taskFindManyMock.mockResolvedValue([makeTask()]);
    taskCountMock.mockResolvedValue(1);
  });

  it("returns tasks with user, organization, and pagination meta", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: "task_1",
        name: "Quarterly report",
        status: "RUNNING",
        createdAt: "2025-01-01T00:00:00.000Z",
        user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    ]);
    expect(body.meta.pagination).toMatchObject({ total: 1, nextCursor: null });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        take: 21,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("returns null organization for personal tasks", async () => {
    taskFindManyMock.mockResolvedValue([makeTask({ organization: null })]);

    const app = createApp(mountListAdminTasks);
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].organization).toBeNull();
  });

  it("builds an OR filter across id, name, user, and organization", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?query=acme");

    expect(res.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { id: "acme" },
            { name: { contains: "acme", mode: "insensitive" } },
            {
              user: {
                OR: [
                  { name: { contains: "acme", mode: "insensitive" } },
                  { email: { contains: "acme", mode: "insensitive" } },
                ],
              },
            },
            {
              organization: {
                OR: [
                  { name: { contains: "acme", mode: "insensitive" } },
                  { slug: { contains: "acme", mode: "insensitive" } },
                ],
              },
            },
          ],
        },
      }),
    );
  });

  it("treats a whitespace-only query as no filter", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?query=%20%20");

    expect(res.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("sets nextCursor when there are more rows than the page size", async () => {
    taskFindManyMock.mockResolvedValue([
      makeTask({ id: "task_0" }),
      makeTask({ id: "task_1" }),
      makeTask({ id: "task_2" }),
    ]);
    taskCountMock.mockResolvedValue(10);

    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?limit=2");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBe("task_1");
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });

  it("rejects limits above the admin list cap", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?limit=51");

    expect(res.status).toBe(422);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin users", async () => {
    const app = createApp(mountListAdminTasks, { role: "user" });
    const res = await app.request("/");

    expect(res.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const app = createApp(mountListAdminTasks, { actor: "coworker" });
    const res = await app.request("/");

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter core test src/routes/v1/admin/admin-task-list.routes.test.ts`
Expected: FAIL — cannot resolve `./tasks/get.js`.

- [ ] **Step 3: Add schemas to `apps/core/src/schemas/admin.schema.ts`**

Add `TaskStatus` to the imports at the top:

```typescript
import { TaskStatus } from "@sokosumi/utils";
```

Append at the end of the file:

```typescript
/**
 * Same rationale as the user overview cap: keep admin list pages bounded.
 */
export const ADMIN_TASK_LIST_MAX_LIMIT = 50;

export const adminTaskListQuerySchema = z
  .object({
    query: z
      .string()
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched against task ID (exact), task name, user name and email, and organization name and slug (case-insensitive). Empty or missing lists all tasks.",
        example: "acme",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_TASK_LIST_MAX_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${ADMIN_TASK_LIST_MAX_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  });

export const adminTaskListItemSchema = z
  .object({
    id: z
      .string()
      .openapi({ example: "0195b9f4-7d35-7a4e-b14e-111111111111" }),
    name: z.string().openapi({ example: "Quarterly report" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    createdAt: dateTimeSchema,
    user: z.object({
      id: z.string().openapi({ example: "user_123" }),
      name: z.string().openapi({ example: "Ada Lovelace" }),
      email: z.string().openapi({ example: "ada@example.com" }),
    }),
    organization: z
      .object({
        id: z.string().openapi({ example: "org_123" }),
        name: z.string().openapi({ example: "Acme Corp" }),
        slug: z.string().openapi({ example: "acme-corp" }),
      })
      .nullable(),
  })
  .openapi("AdminTaskListItem");

export const adminTaskListSchema = z.array(adminTaskListItemSchema);
```

- [ ] **Step 4: Create `apps/core/src/routes/v1/admin/tasks/get.ts`**

```typescript
import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminTaskListQuerySchema,
  adminTaskListSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminTasks",
  description:
    "Paginated list of all tasks, searchable by task ID, task name, user, or organization (admin only).",
  tags: ["Admin"],
  request: {
    query: adminTaskListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminTaskListSchema,
      "Paginated list of tasks for the admin task list",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const term = queryParams.query?.trim();

    const where: Prisma.TaskWhereInput = term
      ? {
          OR: [
            { id: term },
            { name: { contains: term, mode: "insensitive" } },
            {
              user: {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { email: { contains: term, mode: "insensitive" } },
                ],
              },
            },
            {
              organization: {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { slug: { contains: term, mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {};

    const takePlusOne = take + 1;
    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          user: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const items = tasks.slice(0, take).map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      createdAt: task.createdAt,
      user: task.user,
      organization: task.organization,
    }));

    const paginationMeta = createPaginationMeta(
      items,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminTaskListSchema.parse(items), paginationMeta);
  });
}
```

- [ ] **Step 5: Create `apps/core/src/routes/v1/admin/tasks/index.ts`**

```typescript
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListAdminTasks from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminTasks(app);

export default app;
```

- [ ] **Step 6: Mount in `apps/core/src/routes/v1/admin/index.ts`**

Add the import (alphabetical with the others):

```typescript
import tasksRouter from "./tasks/index.js";
```

Add the route after the existing ones:

```typescript
app.route("/tasks", tasksRouter);
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `pnpm --filter core test src/routes/v1/admin/admin-task-list.routes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 8: Run the full core test suite**

Run: `pnpm core:test`
Expected: PASS — no regressions.

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/routes/v1/admin apps/core/src/schemas/admin.schema.ts
git commit -m "feat(core): add admin task list endpoint"
```

---

### Task 2: Web — regenerate Core client, add `listAdminTasks` wrapper

**Files:**
- Regenerate: `apps/web/src/lib/clients/generated/core/*` (never hand-edit)
- Modify: `apps/web/src/lib/clients/core.shared.ts`

- [ ] **Step 1: Regenerate the Core client snapshot**

Run: `pnpm --filter web generate:core:snapshot`
Expected: generated files under `apps/web/src/lib/clients/generated/core/` now include a `listAdminTasks` operation (operationId from the route). Verify with:

```bash
grep -n "listAdminTasks" apps/web/src/lib/clients/generated/core/sdk.gen.ts
```

- [ ] **Step 2: Add the wrapper to `apps/web/src/lib/clients/core.shared.ts`**

Add to the generated-client import list (alphabetical):

```typescript
  listAdminTasks as coreListAdminTasks,
```

Add the function next to `listAdminUserOverview` (keep the same shape):

```typescript
  async function listAdminTasks(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminTasks({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list tasks",
    );
  }
```

Register `listAdminTasks` in the returned client object next to `listAdminUserOverview`.

- [ ] **Step 3: Typecheck/build web**

Run: `pnpm --filter web exec tsc --noEmit` (or `pnpm web:check` for lint)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/clients
git commit -m "feat(web): add listAdminTasks core client operation"
```

---

### Task 3: Web — `admin-task.service.ts` (TDD)

**Files:**
- Test: `apps/web/src/lib/services/__tests__/admin-task.service.test.ts` (create)
- Create: `apps/web/src/lib/services/admin-task.service.ts`

- [ ] **Step 1: Write the failing service test**

Create `apps/web/src/lib/services/__tests__/admin-task.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listAdminTasksMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listAdminTasks: (...args: unknown[]) => listAdminTasksMock(...args),
  },
  CoreApiRequestError: class extends Error {},
}));

import { adminTaskService } from "../admin-task.service";

describe("adminTaskService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps task rows and pagination", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    listAdminTasksMock.mockResolvedValue({
      data: [
        {
          id: "task_1",
          name: "Quarterly report",
          status: "RUNNING",
          createdAt,
          user: {
            id: "user_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
          organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
        },
      ],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_1",
        pagination: { cursor: null, limit: 20, total: 1, nextCursor: null },
      },
    });

    const result = await adminTaskService.listTasks({ query: "acme" });

    expect(listAdminTasksMock).toHaveBeenCalledWith({ query: "acme" });
    expect(result.tasks).toEqual([
      {
        id: "task_1",
        name: "Quarterly report",
        status: "RUNNING",
        createdAt,
        user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it("passes cursor and limit through and surfaces nextCursor", async () => {
    listAdminTasksMock.mockResolvedValue({
      data: [],
      meta: {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        requestId: "req_2",
        pagination: {
          cursor: "task_0",
          limit: 10,
          total: 25,
          nextCursor: "task_9",
        },
      },
    });

    const result = await adminTaskService.listTasks({
      cursor: "task_0",
      limit: 10,
    });

    expect(listAdminTasksMock).toHaveBeenCalledWith({
      cursor: "task_0",
      limit: 10,
    });
    expect(result.nextCursor).toBe("task_9");
    expect(result.total).toBe(25);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter web test src/lib/services/__tests__/admin-task.service.test.ts`
Expected: FAIL — cannot resolve `../admin-task.service`.

- [ ] **Step 3: Create `apps/web/src/lib/services/admin-task.service.ts`**

```typescript
import "server-only";

import { coreClient } from "@/lib/clients/core.client";

/** A task row in the admin task list. */
export interface AdminTaskListItem {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface AdminTaskListPage {
  tasks: AdminTaskListItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminTasksParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

export const adminTaskService = {
  async listTasks(
    params: ListAdminTasksParams = {},
  ): Promise<AdminTaskListPage> {
    const result = await coreClient.listAdminTasks(params);

    return {
      tasks: result.data.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        user: task.user,
        organization: task.organization,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter web test src/lib/services/__tests__/admin-task.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services
git commit -m "feat(web): add admin task service"
```

---

### Task 4: Web — `listAdminTasksAction` (TDD)

**Files:**
- Test: `apps/web/src/lib/actions/admin-tasks/__tests__/action.test.ts` (create)
- Create: `apps/web/src/lib/actions/admin-tasks/action.ts`

- [ ] **Step 1: Write the failing action test**

Create `apps/web/src/lib/actions/admin-tasks/__tests__/action.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listTasksServiceMock = vi.fn();
const assertAdminSessionMock = vi.fn();

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: (...args: unknown[]) => assertAdminSessionMock(...args),
}));

vi.mock("@/lib/services/admin-task.service", () => ({
  adminTaskService: {
    listTasks: (...args: unknown[]) => listTasksServiceMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import { listAdminTasksAction } from "../action";

describe("listAdminTasksAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the task page for an admin session", async () => {
    const page = {
      tasks: [
        {
          id: "task_1",
          name: "Quarterly report",
          status: "RUNNING",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          user: {
            id: "user_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
          organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
        },
      ],
      total: 1,
      nextCursor: null,
    };
    listTasksServiceMock.mockResolvedValue(page);

    const result = await listAdminTasksAction({ query: "acme", limit: 20 });

    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(listTasksServiceMock).toHaveBeenCalledWith({
      query: "acme",
      cursor: undefined,
      limit: 20,
    });
    expect(result).toEqual({ ok: true, data: page });
  });

  it("rejects a non-admin session with UNAUTHORIZED", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await listAdminTasksAction({ query: "acme" });

    expect(listTasksServiceMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("maps service failures to INTERNAL_SERVER_ERROR", async () => {
    assertAdminSessionMock.mockImplementation(() => undefined);
    listTasksServiceMock.mockRejectedValue(new Error("core down"));

    const result = await listAdminTasksAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      expect(result.error.message).toBe("core down");
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter web test src/lib/actions/admin-tasks/__tests__/action.test.ts`
Expected: FAIL — cannot resolve `../action`.

- [ ] **Step 3: Create `apps/web/src/lib/actions/admin-tasks/action.ts`**

```typescript
"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminTaskListPage,
  adminTaskService,
  type ListAdminTasksParams,
} from "@/lib/services/admin-task.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : "Failed to list tasks",
  };
}

interface ListAdminTasksRequest
  extends AuthenticatedRequest,
    ListAdminTasksParams {}

export const listAdminTasksAction = withSession<
  ListAdminTasksRequest,
  Result<AdminTaskListPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminTaskService.listTasks({ query, cursor, limit }));
  } catch (error) {
    return Err(mapError(error));
  }
});
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter web test src/lib/actions/admin-tasks/__tests__/action.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/actions/admin-tasks
git commit -m "feat(web): add admin task list action"
```

---

### Task 5: Web — UI: admin section, page, list component, i18n

**Files:**
- Modify: `apps/web/src/app/(app)/admin/admin-sections.ts`
- Create: `apps/web/src/app/(app)/admin/tasks/page.tsx`
- Create: `apps/web/src/components/admin/tasks/task-list.tsx`
- Modify: `apps/web/messages/{en,de,es,fr,it,ja,pt,pt-BR,zh-Hans}.json`

- [ ] **Step 1: Add the admin hub section**

In `apps/web/src/app/(app)/admin/admin-sections.ts`, add `ListTodo` to the lucide import and append to `ADMIN_SECTIONS`:

```typescript
  {
    key: "tasks",
    href: "/admin/tasks",
    Icon: ListTodo,
  },
```

- [ ] **Step 2: Create `apps/web/src/components/admin/tasks/task-list.tsx`**

```typescript
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEnvPublicConfig } from "@/config/env.public";
import { listAdminTasksAction } from "@/lib/actions/admin-tasks/action";
import type {
  AdminTaskListItem,
  AdminTaskListPage,
} from "@/lib/services/admin-task.service";

interface TaskListProps {
  initialPage: AdminTaskListPage;
}

/**
 * Searchable admin list of all tasks. The page server-renders the first
 * (unfiltered) page as `initialPage`; the search input re-fetches through a
 * server action so the task/user/organization filter runs against the full
 * task table, and "load more" appends the next cursor page for the active
 * query.
 */
export function TaskList({ initialPage }: TaskListProps) {
  const t = useTranslations("App.Admin.Tasks.TaskList");
  const formatter = useFormatter();

  const [tasks, setTasks] = useState<AdminTaskListItem[]>(initialPage.tasks);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // Monotonic id so out-of-order responses from rapid typing are ignored —
  // only the latest request is allowed to update the list.
  const latestRequestId = useRef(0);

  // Without a cursor the result replaces the list (new search); with a cursor
  // it appends the next page for the active query.
  function fetchPage(query: string, cursor?: string) {
    const requestId = ++latestRequestId.current;
    startTransition(async () => {
      const result = await listAdminTasksAction({
        query: query.trim() || undefined,
        cursor,
      });
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setTasks((current) =>
        cursor ? [...current, ...result.data.tasks] : result.data.tasks,
      );
      setTotal(result.data.total);
      setNextCursor(result.data.nextCursor);
    });
  }

  const debouncedSearch = useDebouncedCallback(
    (value: string) => fetchPage(value),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    debouncedSearch(value);
  }

  function handleLoadMore() {
    if (!nextCursor) {
      return;
    }
    fetchPage(search, nextCursor);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-sm"
          aria-label={t("searchPlaceholder")}
        />
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("totalCount", { count: total })}
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("task")}</TableHead>
                <TableHead>{t("user")}</TableHead>
                <TableHead>{t("organization")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="pr-4">{t("created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="pl-4">
                    <span className="flex flex-col">
                      <span className="font-medium">{task.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {task.id}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{task.user.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {task.user.email}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {task.organization ? (
                      task.organization.name
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{task.status}</Badge>
                  </TableCell>
                  <TableCell className="pr-4">
                    {formatter.dateTime(task.createdAt, {
                      dateStyle: "medium",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/app/(app)/admin/tasks/page.tsx`**

```typescript
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { TaskList } from "@/components/admin/tasks/task-list";
import { adminTaskService } from "@/lib/services/admin-task.service";

export const metadata: Metadata = {
  title: "Tasks",
  description: "Searchable list of all tasks",
};

export default async function AdminTasksPage() {
  const t = await getTranslations("App.Admin.Tasks");
  const initialPage = await adminTaskService.listTasks();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <TaskList initialPage={initialPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys to all nine locale catalogs**

Each catalog gets (a) a `tasks` entry in `App.Admin.Overview.Sections` (next to `users`) and (b) an `App.Admin.Tasks` block (next to `App.Admin.Users`). Match the surrounding JSON structure exactly (the `Sections` object and the `Admin` object).

`en.json`:

```json
"tasks": {
  "title": "Tasks",
  "description": "Searchable list of all tasks across users and organizations."
}
```

```json
"Tasks": {
  "title": "Tasks",
  "description": "Searchable list of all tasks",
  "TaskList": {
    "searchPlaceholder": "Search by task, user, or organization…",
    "totalCount": "{count, plural, one {# task} other {# tasks}}",
    "empty": "No tasks found.",
    "task": "Task",
    "user": "User",
    "organization": "Organization",
    "status": "Status",
    "created": "Created",
    "loadMore": "Load more",
    "loadError": "Failed to load tasks."
  }
}
```

`de.json`:

```json
"tasks": {
  "title": "Aufgaben",
  "description": "Durchsuchbare Liste aller Aufgaben über Benutzer und Organisationen hinweg."
}
```

```json
"Tasks": {
  "title": "Aufgaben",
  "description": "Durchsuchbare Liste aller Aufgaben",
  "TaskList": {
    "searchPlaceholder": "Nach Aufgabe, Benutzer oder Organisation suchen…",
    "totalCount": "{count, plural, one {# Aufgabe} other {# Aufgaben}}",
    "empty": "Keine Aufgaben gefunden.",
    "task": "Aufgabe",
    "user": "Benutzer",
    "organization": "Organisation",
    "status": "Status",
    "created": "Erstellt",
    "loadMore": "Mehr laden",
    "loadError": "Aufgaben konnten nicht geladen werden."
  }
}
```

`es.json`:

```json
"tasks": {
  "title": "Tareas",
  "description": "Lista de todas las tareas con búsqueda por usuarios y organizaciones."
}
```

```json
"Tasks": {
  "title": "Tareas",
  "description": "Lista de todas las tareas con búsqueda",
  "TaskList": {
    "searchPlaceholder": "Buscar por tarea, usuario u organización…",
    "totalCount": "{count, plural, one {# tarea} other {# tareas}}",
    "empty": "No se encontraron tareas.",
    "task": "Tarea",
    "user": "Usuario",
    "organization": "Organización",
    "status": "Estado",
    "created": "Creada",
    "loadMore": "Cargar más",
    "loadError": "No se pudieron cargar las tareas."
  }
}
```

`fr.json`:

```json
"tasks": {
  "title": "Tâches",
  "description": "Liste consultable de toutes les tâches, tous utilisateurs et organisations confondus."
}
```

```json
"Tasks": {
  "title": "Tâches",
  "description": "Liste consultable de toutes les tâches",
  "TaskList": {
    "searchPlaceholder": "Rechercher par tâche, utilisateur ou organisation…",
    "totalCount": "{count, plural, one {# tâche} other {# tâches}}",
    "empty": "Aucune tâche trouvée.",
    "task": "Tâche",
    "user": "Utilisateur",
    "organization": "Organisation",
    "status": "Statut",
    "created": "Créée",
    "loadMore": "Charger plus",
    "loadError": "Échec du chargement des tâches."
  }
}
```

`it.json`:

```json
"tasks": {
  "title": "Attività",
  "description": "Elenco ricercabile di tutte le attività tra utenti e organizzazioni."
}
```

```json
"Tasks": {
  "title": "Attività",
  "description": "Elenco ricercabile di tutte le attività",
  "TaskList": {
    "searchPlaceholder": "Cerca per attività, utente o organizzazione…",
    "totalCount": "{count, plural, one {# attività} other {# attività}}",
    "empty": "Nessuna attività trovata.",
    "task": "Attività",
    "user": "Utente",
    "organization": "Organizzazione",
    "status": "Stato",
    "created": "Creata",
    "loadMore": "Carica altro",
    "loadError": "Impossibile caricare le attività."
  }
}
```

`ja.json`:

```json
"tasks": {
  "title": "タスク",
  "description": "ユーザーや組織を横断してすべてのタスクを検索できる一覧です。"
}
```

```json
"Tasks": {
  "title": "タスク",
  "description": "検索可能なすべてのタスクの一覧",
  "TaskList": {
    "searchPlaceholder": "タスク、ユーザー、組織で検索…",
    "totalCount": "{count, plural, other {# 件のタスク}}",
    "empty": "タスクが見つかりません。",
    "task": "タスク",
    "user": "ユーザー",
    "organization": "組織",
    "status": "ステータス",
    "created": "作成日",
    "loadMore": "さらに読み込む",
    "loadError": "タスクの読み込みに失敗しました。"
  }
}
```

`pt.json`:

```json
"tasks": {
  "title": "Tarefas",
  "description": "Lista pesquisável de todas as tarefas entre utilizadores e organizações."
}
```

```json
"Tasks": {
  "title": "Tarefas",
  "description": "Lista pesquisável de todas as tarefas",
  "TaskList": {
    "searchPlaceholder": "Pesquisar por tarefa, utilizador ou organização…",
    "totalCount": "{count, plural, one {# tarefa} other {# tarefas}}",
    "empty": "Nenhuma tarefa encontrada.",
    "task": "Tarefa",
    "user": "Utilizador",
    "organization": "Organização",
    "status": "Estado",
    "created": "Criada",
    "loadMore": "Carregar mais",
    "loadError": "Falha ao carregar as tarefas."
  }
}
```

`pt-BR.json`:

```json
"tasks": {
  "title": "Tarefas",
  "description": "Lista pesquisável de todas as tarefas entre usuários e organizações."
}
```

```json
"Tasks": {
  "title": "Tarefas",
  "description": "Lista pesquisável de todas as tarefas",
  "TaskList": {
    "searchPlaceholder": "Pesquisar por tarefa, usuário ou organização…",
    "totalCount": "{count, plural, one {# tarefa} other {# tarefas}}",
    "empty": "Nenhuma tarefa encontrada.",
    "task": "Tarefa",
    "user": "Usuário",
    "organization": "Organização",
    "status": "Status",
    "created": "Criada",
    "loadMore": "Carregar mais",
    "loadError": "Falha ao carregar as tarefas."
  }
}
```

`zh-Hans.json`:

```json
"tasks": {
  "title": "任务",
  "description": "可跨用户和组织搜索的所有任务列表。"
}
```

```json
"Tasks": {
  "title": "任务",
  "description": "可搜索的所有任务列表",
  "TaskList": {
    "searchPlaceholder": "按任务、用户或组织搜索…",
    "totalCount": "{count, plural, other {# 个任务}}",
    "empty": "未找到任务。",
    "task": "任务",
    "user": "用户",
    "organization": "组织",
    "status": "状态",
    "created": "创建时间",
    "loadMore": "加载更多",
    "loadError": "加载任务失败。"
  }
}
```

- [ ] **Step 5: Lint, format, and run the web suite**

Run: `pnpm format && pnpm web:check && pnpm web:test`
Expected: clean format/lint; all web tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/components/admin/tasks apps/web/messages
git commit -m "feat(web): add searchable admin task list page"
```

---

### Task 6: Verification & wrap-up

- [ ] **Step 1: Full test run**

Run: `pnpm test`
Expected: all workspaces pass.

- [ ] **Step 2: Repo-wide Biome check**

Run: `pnpm check`
Expected: no diagnostics.

- [ ] **Step 3: Production builds**

Run: `pnpm core:build && pnpm web:build`
Expected: both build cleanly.

- [ ] **Step 4: Commit any remaining fixes, then squash-merge decision**

Follow `superpowers:finishing-a-development-branch`: open a draft PR titled with the primary commit subject, e.g. `feat(web): add searchable admin task list (#SOK-566 branch)` — final title must be a Conventional Commit, e.g. `feat(web): add searchable admin task list page`.
