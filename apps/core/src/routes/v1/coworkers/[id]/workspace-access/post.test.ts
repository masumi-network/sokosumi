import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

const { upsertMock, resolveWorkspaceMock, prismaTransactionMock } = vi.hoisted(
  () => ({
    upsertMock: vi.fn(),
    resolveWorkspaceMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }),
);

vi.mock("@/helpers/coworker-workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/coworker-workspace-access")
    >();
  return {
    ...actual,
    upsertCoworkerWorkspaceAccess: (...args: unknown[]) => upsertMock(...args),
    resolveCoworkerAccessTargetWorkspaceId: (...args: unknown[]) =>
      resolveWorkspaceMock(...args),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

import mountPostCoworkerWorkspaceAccess from "./post";

const coworkerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actorUserId = "user_123";
const now = new Date("2026-08-05T12:00:00.000Z");

function baseAccess(
  overrides: {
    status?: CoworkerWorkspaceAccessStatus;
    resolvedAt?: Date | null;
    resolvedById?: string | null;
  } = {},
) {
  return {
    id: accessId,
    coworkerId,
    coworker: { name: "Ops Pilot", slug: "ops-pilot" },
    workspace: {
      id: "workspace-1",
      userId: null,
      organizationId: "org-1",
      user: null,
      organization: { name: "Acme Corp", slug: "acme-corp" },
    },
    workspaceId,
    status: overrides.status ?? CoworkerWorkspaceAccessStatus.GRANTED,
    requestedByUserId: actorUserId,
    resolvedAt: overrides.resolvedAt === undefined ? now : overrides.resolvedAt,
    resolvedById:
      overrides.resolvedById === undefined
        ? actorUserId
        : overrides.resolvedById,
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(role = "user", userId = actorUserId) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role,
    });
    return await next();
  });

  mountPostCoworkerWorkspaceAccess(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

async function postWorkspaceAccess(app: ReturnType<typeof createApp>) {
  return app.request(`http://localhost/${coworkerId}/workspace-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
}

describe("POST /coworkers/{id}/workspace-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorkspaceMock.mockResolvedValue(workspaceId);
    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("platform admin → 201 GRANTED", async () => {
    upsertMock.mockResolvedValue(
      baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
    );

    const response = await postWorkspaceAccess(createApp("admin"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      id: accessId,
      coworkerId,
      coworkerName: "Ops Pilot",
      coworkerSlug: "ops-pilot",
      workspaceId,
      status: "GRANTED",
      requestedByUserId: actorUserId,
      resolvedById: actorUserId,
    });
    expect(resolveWorkspaceMock).toHaveBeenCalledWith(
      { workspaceId },
      {},
      expect.anything(),
    );
    expect(upsertMock).toHaveBeenCalledWith(
      {
        coworkerId,
        workspaceId,
        actorUserId,
        isPlatformAdmin: true,
      },
      expect.anything(),
    );
  });

  it("vendor admin member workspace → 201 GRANTED", async () => {
    upsertMock.mockResolvedValue(
      baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
    );

    const response = await postWorkspaceAccess(createApp("user"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("GRANTED");
    expect(upsertMock).toHaveBeenCalledWith(
      {
        coworkerId,
        workspaceId,
        actorUserId,
        isPlatformAdmin: false,
      },
      expect.anything(),
    );
  });

  it("vendor admin foreign → 201 PENDING", async () => {
    upsertMock.mockResolvedValue(
      baseAccess({
        status: CoworkerWorkspaceAccessStatus.PENDING,
        resolvedAt: null,
        resolvedById: null,
      }),
    );

    const response = await postWorkspaceAccess(createApp("user"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      status: "PENDING",
      resolvedAt: null,
      resolvedById: null,
    });
  });

  it("random user → 403", async () => {
    upsertMock.mockRejectedValue(forbidden("Vendor admin access required"));

    const response = await postWorkspaceAccess(createApp("user", "stranger"));

    expect(response.status).toBe(403);
    expect(upsertMock).toHaveBeenCalledWith(
      {
        coworkerId,
        workspaceId,
        actorUserId: "stranger",
        isPlatformAdmin: false,
      },
      expect.anything(),
    );
  });

  it("missing workspace → 404", async () => {
    upsertMock.mockRejectedValue(notFound("Workspace not found"));

    const response = await postWorkspaceAccess(createApp("admin"));

    expect(response.status).toBe(404);
  });
});
