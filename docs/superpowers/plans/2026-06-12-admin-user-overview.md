# Admin User Overview Implementation Plan (SOK-565)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Searchable, paginated admin view listing all users with available credits, current subscription, started-task count, and registration date.

**Architecture:** New admin Core endpoint `GET /v1/admin/users/overview` (cursor pagination + server-side search) backed by a new `userRepository.listUsersForAdminOverview` method and existing credit/subscription helpers; web consumes it via regenerated Core client → `adminUserService.listUsers` → `listAdminUsersAction` → `/admin/users` page with a client `UserList` table component.

**Tech Stack:** Hono + zod-openapi (core), Prisma (`@sokosumi/database`), Next.js App Router + shadcn Table + next-intl (web), Vitest.

Spec: `docs/superpowers/specs/2026-06-12-admin-user-overview-design.md`

---

### Task 1: `userRepository.listUsersForAdminOverview`

**Files:**
- Modify: `packages/database/src/repositories/user.repository.ts`
- Test: `packages/database/src/repositories/__tests__/user.repository.test.ts`

- [ ] **Step 1: Write failing tests** — append to the existing test file (it already mocks `tx.user.findMany`; add `count`):

```ts
const countMock = vi.fn();
// extend the existing `tx` mock object: user: { findMany: findManyMock, count: countMock }

describe("userRepository.listUsersForAdminOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);
    countMock.mockResolvedValue(1);
  });

  it("lists users newest-first with pagination args and total", async () => {
    const result = await userRepository.listUsersForAdminOverview(
      { take: 21, skip: 1, cursor: "user_0" },
      tx,
    );

    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      skip: 1,
      cursor: { id: "user_0" },
    });
    expect(countMock).toHaveBeenCalledWith({ where: {} });
    expect(result.total).toBe(1);
    expect(result.users).toHaveLength(1);
  });

  it("filters by name or email when a query is given", async () => {
    await userRepository.listUsersForAdminOverview(
      { query: "  ada  ", take: 21 },
      tx,
    );

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "ada", mode: "insensitive" } },
            { email: { contains: "ada", mode: "insensitive" } },
          ],
        },
        cursor: undefined,
        skip: undefined,
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sokosumi/database test src/repositories/__tests__/user.repository.test.ts`
Expected: FAIL — `listUsersForAdminOverview is not a function`

- [ ] **Step 3: Implement** — add to `userRepository` (after `searchUsers`):

```ts
/**
 * Paginated user listing for the admin user overview. Empty/missing query
 * lists all users (unlike `searchUsers`, which is a picker and returns
 * nothing for empty queries). Ordered newest-first.
 */
listUsersForAdminOverview: async (
  params: {
    query?: string;
    cursor?: string;
    take: number;
    skip?: number;
  },
  tx: Prisma.TransactionClient,
): Promise<{
  users: Array<Pick<User, "id" | "name" | "email" | "createdAt">>;
  total: number;
}> => {
  const trimmed = params.query?.trim();
  const where: Prisma.UserWhereInput = trimmed
    ? {
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { email: { contains: trimmed, mode: "insensitive" } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    tx.user.findMany({
      where,
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: params.take,
      skip: params.skip,
      cursor: params.cursor ? { id: params.cursor } : undefined,
    }),
    tx.user.count({ where }),
  ]);

  return { users, total };
},
```

(`Prisma` and `User` types are already imported in this file.)

- [ ] **Step 4: Run tests** — same command, expected: PASS
- [ ] **Step 5: Commit** — `feat(database): add admin overview user listing to user repository`

### Task 2: Core schemas

**Files:**
- Modify: `apps/core/src/schemas/admin.schema.ts`

- [ ] **Step 1: Add schemas** (no dedicated test — exercised by route tests in Task 3):

```ts
import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const adminUserOverviewQuerySchema = z
  .object({
    query: z
      .string()
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched case-insensitively against user name and email. Empty lists all users.",
        example: "ada",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape);

export const adminUserOverviewItemSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
    createdAt: dateTimeSchema,
    credits: z.number().openapi({
      description: "Available personal credits",
      example: 42.5,
    }),
    subscriptionPlan: z
      .string()
      .nullable()
      .openapi({ example: "pro", description: "Active subscription plan, if any" }),
    subscriptionStatus: z
      .string()
      .nullable()
      .openapi({ example: "active" }),
    startedTaskCount: z.number().int().min(0).openapi({
      description: "Number of tasks the user has started (status beyond DRAFT)",
      example: 7,
    }),
  })
  .openapi("AdminUserOverviewItem");

export const adminUserOverviewListSchema = z.array(adminUserOverviewItemSchema);
```

- [ ] **Step 2: Typecheck/lint** — `pnpm --filter @sokosumi/core exec tsc --noEmit` (or build) — expected: clean
- [ ] **Step 3: Commit with Task 3** (schemas + route belong together)

### Task 3: Core route `GET /v1/admin/users/overview`

**Files:**
- Create: `apps/core/src/routes/v1/admin/users/overview/get.ts`
- Modify: `apps/core/src/routes/v1/admin/users/index.ts`
- Test: `apps/core/src/routes/v1/admin/admin-user-overview.routes.test.ts`

- [ ] **Step 1: Write failing route tests** — same harness as `admin.routes.test.ts` (copy its `createApp`); mocks:

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  listUsersForAdminOverviewMock,
  getCreditsMock,
  resolveActiveSubscriptionMock,
  taskGroupByMock,
} = vi.hoisted(() => ({
  listUsersForAdminOverviewMock: vi.fn(),
  getCreditsMock: vi.fn(),
  resolveActiveSubscriptionMock: vi.fn(),
  taskGroupByMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { task: { groupBy: taskGroupByMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: { listUsersForAdminOverview: listUsersForAdminOverviewMock },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: resolveActiveSubscriptionMock,
  },
}));

vi.mock("@/helpers/user", () => ({ getCredits: getCreditsMock }));

const { default: mountListAdminUserOverview } = await import(
  "./users/overview/get.js"
);

// createApp(...) identical to admin.routes.test.ts

describe("GET /v1/admin/users/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsersForAdminOverviewMock.mockResolvedValue({
      users: [
        {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
      total: 1,
    });
    getCreditsMock.mockResolvedValue(42.5);
    resolveActiveSubscriptionMock.mockResolvedValue({
      plan: "pro",
      status: "active",
    });
    taskGroupByMock.mockResolvedValue([
      { userId: "user_1", _count: { _all: 7 } },
    ]);
  });

  it("returns enriched users with pagination meta", async () => {
    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/?query=ada");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: "2025-01-01T00:00:00.000Z",
        credits: 42.5,
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        startedTaskCount: 7,
      },
    ]);
    expect(body.meta.pagination).toMatchObject({
      total: 1,
      nextCursor: null,
    });
    expect(listUsersForAdminOverviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "ada", take: 21 }),
      expect.anything(),
    );
    expect(taskGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["ownerId"],
        where: expect.objectContaining({
          ownerId: { in: ["user_1"] },
          status: { not: "DRAFT" },
        }),
      }),
    );
  });

  it("defaults missing enrichment to null/zero", async () => {
    resolveActiveSubscriptionMock.mockResolvedValue(null);
    taskGroupByMock.mockResolvedValue([]);
    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/");
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      subscriptionPlan: null,
      subscriptionStatus: null,
      startedTaskCount: 0,
    });
  });

  it("sets nextCursor when there are more rows than the page size", async () => {
    listUsersForAdminOverviewMock.mockResolvedValue({
      users: Array.from({ length: 3 }, (_, i) => ({
        id: `user_${i}`,
        name: `User ${i}`,
        email: `u${i}@example.com`,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      })),
      total: 10,
    });
    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/?limit=2");
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBe("user_1");
  });

  it("rejects non-admin users", async () => {
    const app = createApp(mountListAdminUserOverview, { role: "user" });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sokosumi/core test src/routes/v1/admin/admin-user-overview.routes.test.ts`
Expected: FAIL — module `./users/overview/get.js` not found

- [ ] **Step 3: Implement route** — `apps/core/src/routes/v1/admin/users/overview/get.ts`:

```ts
import { createRoute } from "@hono/zod-openapi";
import {
  subscriptionRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { TaskStatus } from "@sokosumi/utils";

import { jsonErrorResponse, jsonPaginatedSuccessResponse } from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminUserOverviewListSchema,
  adminUserOverviewQuerySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminUserOverview",
  description:
    "Paginated overview of all users with credits, subscription, and started-task counts (admin only).",
  tags: ["Admin"],
  request: { query: adminUserOverviewQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminUserOverviewListSchema,
      "Paginated list of users for the admin overview",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const { users, total } = await userRepository.listUsersForAdminOverview(
      { query: queryParams.query, cursor, take: take + 1, skip },
      prisma,
    );

    const hasMore = users.length === take + 1;
    const pageUsers = users.slice(0, take);
    const userIds = pageUsers.map((user) => user.id);

    const [credits, subscriptions, taskCounts] = await Promise.all([
      Promise.all(userIds.map((userId) => getCredits(userId, null, prisma))),
      Promise.all(
        userIds.map((userId) =>
          subscriptionRepository.resolveActiveSubscriptionByReferenceId(
            userId,
            prisma,
          ),
        ),
      ),
      userIds.length > 0
        ? prisma.task.groupBy({
            by: ["ownerId"],
            where: {
              ownerId: { in: userIds },
              status: { not: TaskStatus.DRAFT },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const taskCountByUserId = new Map(
      taskCounts.map((row) => [row.ownerId, row._count._all]),
    );

    const items = pageUsers.map((user, index) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      credits: credits[index] ?? 0,
      subscriptionPlan: subscriptions[index]?.plan ?? null,
      subscriptionStatus: subscriptions[index]?.status ?? null,
      startedTaskCount: taskCountByUserId.get(user.id) ?? 0,
    }));

    const paginationMeta = createPaginationMeta(
      pageUsers,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminUserOverviewListSchema.parse(items), paginationMeta);
  });
}
```

Mount in `apps/core/src/routes/v1/admin/users/index.ts`:

```ts
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountSearchAdminUsers from "./get.js";
import mountListAdminUserOverview from "./overview/get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchAdminUsers(app);

const overviewApp = new OpenAPIHonoWithAuth();
mountListAdminUserOverview(overviewApp);
app.route("/overview", overviewApp);

export default app;
```

(Check how sibling routers nest paths — `organizations/index.ts` mounts `[slug]` — and mirror that mechanism; if routes mount with explicit `path: "/overview"` on the same router instead, do that.)

- [ ] **Step 4: Run tests** — route test + full core suite: `pnpm core:test` — expected: PASS
- [ ] **Step 5: Commit** — `feat(core): add admin user overview endpoint`

### Task 4: Regenerate web Core client

- [ ] **Step 1:** Run `pnpm --filter web generate:core:snapshot`
- [ ] **Step 2:** Verify `listAdminUserOverview` appears in `apps/web/src/lib/clients/generated/core/sdk.gen.ts`
- [ ] **Step 3:** Add wrapper in `apps/web/src/lib/clients/core.shared.ts` (import `listAdminUserOverview as coreListAdminUserOverview` next to the other admin imports; add function next to `searchAdminUsers`; export it in the returned client object):

```ts
async function listAdminUserOverview(query: {
  query?: string;
  cursor?: string;
  limit?: number;
}) {
  return executeOperation(
    getClient,
    (client) =>
      coreListAdminUserOverview({
        client,
        query,
        cache: "no-store",
      }),
    "Failed to list users",
  );
}
```

- [ ] **Step 4:** Commit — `feat(web): regenerate core client with admin user overview` (generated files committed as-is)

### Task 5: Web service + action

**Files:**
- Modify: `apps/web/src/lib/services/admin-user.service.ts`
- Create: `apps/web/src/lib/actions/admin-users/action.ts`
- Test: `apps/web/src/lib/services/__tests__/admin-user.service.test.ts`, `apps/web/src/lib/actions/admin-users/__tests__/action.test.ts`

- [ ] **Step 1: Failing service test** — follow the existing mock style in `admin-user.service.test.ts` (mocks `coreClient`):

```ts
it("maps overview rows and pagination", async () => {
  listAdminUserOverviewMock.mockResolvedValue({
    data: [
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: "2025-01-01T00:00:00.000Z",
        credits: 42.5,
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        startedTaskCount: 7,
      },
    ],
    meta: {
      timestamp: "2025-01-01T00:00:00.000Z",
      requestId: "req_1",
      pagination: { cursor: null, limit: 20, total: 1, nextCursor: null },
    },
  });

  const result = await adminUserService.listUsers({ query: "ada" });

  expect(listAdminUserOverviewMock).toHaveBeenCalledWith({ query: "ada" });
  expect(result.users[0]).toMatchObject({
    id: "user_1",
    credits: 42.5,
    startedTaskCount: 7,
  });
  expect(result.nextCursor).toBeNull();
  expect(result.total).toBe(1);
});
```

- [ ] **Step 2: Implement service:**

```ts
export interface AdminUserOverviewItem {
  id: string;
  name: string;
  email: string;
  /** Registration date as ISO datetime string. */
  createdAt: string;
  credits: number;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  startedTaskCount: number;
}

export interface AdminUserOverviewPage {
  users: AdminUserOverviewItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminUsersParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

// in adminUserService:
async listUsers(params: ListAdminUsersParams = {}): Promise<AdminUserOverviewPage> {
  const result = await coreClient.listAdminUserOverview(params);

  return {
    users: result.data.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      credits: user.credits,
      subscriptionPlan: user.subscriptionPlan,
      subscriptionStatus: user.subscriptionStatus,
      startedTaskCount: user.startedTaskCount,
    })),
    total: result.meta.pagination.total,
    nextCursor: result.meta.pagination.nextCursor,
  };
}
```

- [ ] **Step 3: Action** — `apps/web/src/lib/actions/admin-users/action.ts`, mirroring `admin-search/action.ts` exactly (same `mapError`, `withSession`, `assertAdminSession`):

```ts
"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type AdminUserOverviewPage,
  adminUserService,
  type ListAdminUsersParams,
} from "@/lib/services/admin-user.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
  }
  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : "Failed to list users",
  };
}

interface ListAdminUsersRequest extends AuthenticatedRequest, ListAdminUsersParams {}

export const listAdminUsersAction = withSession<
  ListAdminUsersRequest,
  Result<AdminUserOverviewPage, ActionError>
>(async ({ session, query, cursor, limit }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminUserService.listUsers({ query, cursor, limit }));
  } catch (error) {
    return Err(mapError(error));
  }
});
```

- [ ] **Step 4: Action test** — mirror `admin-search/__tests__/action.test.ts` (admin gate rejects non-admin; success path returns Ok with service result).
- [ ] **Step 5: Run** `pnpm web:test -- src/lib/services/__tests__/admin-user.service.test.ts src/lib/actions/admin-users` (use the repo's targeted-rerun convention) — expected: PASS
- [ ] **Step 6: Commit** — `feat(web): add admin user overview service and action`

### Task 6: Web UI — page, list component, admin section, i18n

**Files:**
- Create: `apps/web/src/app/(app)/admin/users/page.tsx`
- Create: `apps/web/src/components/admin/users/user-list.tsx`
- Modify: `apps/web/src/app/(app)/admin/admin-sections.ts`
- Modify: `apps/web/messages/*.json` (all 9 catalogs)

- [ ] **Step 1: Page** (server component; admin layout enforces access):

```tsx
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { UserList } from "@/components/admin/users/user-list";
import { adminUserService } from "@/lib/services/admin-user.service";

export const metadata: Metadata = {
  title: "Users",
  description: "Searchable overview of all users",
};

export default async function AdminUsersPage() {
  const t = await getTranslations("App.Admin.Users");
  const initialPage = await adminUserService.listUsers();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <UserList initialPage={initialPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `UserList` client component** — modeled on `invoice-list.tsx`: local state, `useTransition`, monotonic request id, debounced search input (300 ms via `setTimeout` in `useEffect` or the codebase's existing debounce util if one exists — check `async-search-combobox.tsx` first and reuse), shadcn `Table`, columns: Name (+email under it), Credits (`formatter.number`), Subscription (plan + status badge, dash when null), Started tasks, Registered (`formatter.dateTime`). "Load more" button shown while `nextCursor` is set; appends rows via `listAdminUsersAction({ cursor })` preserving the active query. Search resets the list. Toast on action error like `invoice-list.tsx`.
- [ ] **Step 3: Admin hub entry** — `admin-sections.ts`:

```ts
import { Building2, Coins, type LucideIcon, Users } from "lucide-react";
// ...
  {
    key: "users",
    href: "/admin/users",
    Icon: Users,
  },
```

- [ ] **Step 4: i18n** — add to `App.Admin.Overview.Sections` a `users` entry and a new `App.Admin.Users` block (title, description, search placeholder, column headers, empty state, load more, error toast, none/dash label) in `en.json`; translate equivalents into de, es, fr, it, ja, pt, pt-BR, zh-Hans.
- [ ] **Step 5: Verify** — `pnpm web:build` (or at minimum `pnpm --filter web exec tsc --noEmit`) and `pnpm check` — expected: clean
- [ ] **Step 6: Commit** — `feat(web): add searchable admin user overview page`

### Task 7: Final verification

- [ ] `pnpm format` then `pnpm check` — clean
- [ ] `pnpm test` from repo root — all green
- [ ] `pnpm core:build` and `pnpm web:build` — succeed
- [ ] Re-read SOK-565 requirements against the result (credits ✓ subscription ✓ started tasks ✓ registration date ✓ search ✓ admin-only ✓)
