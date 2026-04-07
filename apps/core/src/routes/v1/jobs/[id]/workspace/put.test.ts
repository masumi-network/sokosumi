import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPutJobWorkspace, { putJobWorkspaceRequestSchema } from "./put";

const {
  jobFindFirstMock,
  jobFindUniqueMock,
  jobUpdateMock,
  mapJobWithStatusMock,
  prismaTransactionMock,
  resolveMemberOrganizationByIdMock,
  resolveWorkspaceForContextMock,
  serializeJobDetailsMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  jobFindFirstMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  mapJobWithStatusMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
  serializeJobDetailsMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    mapJobWithStatus: mapJobWithStatusMock,
    resolveWorkspaceForContext: resolveWorkspaceForContextMock,
  };
});

vi.mock("@/types/job", () => ({
  serializeJobDetails: serializeJobDetailsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

interface OwnedJobRecord {
  id: string;
  userId: string;
  organizationId: string | null;
  taskId: string | null;
  jobScheduleId: string | null;
  workspaceId: string;
}

interface TransactionMock {
  job: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  workspace: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

/** Matches `resolveWorkspaceForContextMock` default active workspace id */
const ACTIVE_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function createOwnedJobRecord(
  overrides: Partial<OwnedJobRecord> = {},
): OwnedJobRecord {
  return {
    id: "job_123",
    userId: "user_123",
    organizationId: "org_billing",
    taskId: null,
    jobScheduleId: null,
    workspaceId: ACTIVE_WORKSPACE_ID,
    ...overrides,
  };
}

function createJobApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job_123",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    completedAt: null,
    agentId: "agent_123",
    userId: "user_123",
    organizationId: "org_billing",
    taskId: null,
    name: "Current job",
    jobType: "PAID",
    status: "processing",
    credits: 5,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    input: "{}",
    inputHash: null,
    inputSchema: "{}",
    agentJobId: "agent_job_123",
    identifierFromPurchaser: null,
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: null,
      organization: null,
    },
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: null,
    agent: {
      id: "agent_123",
      name: "Agent",
      overrideName: null,
      icon: null,
      image: null,
      overrideImage: null,
      legalPrivacyPolicy: null,
      overrideLegalPrivacyPolicy: null,
      legalTerms: null,
      overrideLegalTerms: null,
    },
    events: [],
    ...overrides,
  };
}

function createApp(activeOrganizationId: string | null = null) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: activeOrganizationId,
    });

    return await next();
  });

  mountPutJobWorkspace(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function mockTransaction(tx: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(tx);
  });
}

describe("putJobWorkspaceRequestSchema", () => {
  it("requires organizationId", () => {
    expect(() => putJobWorkspaceRequestSchema.parse({})).toThrow();
  });

  it("accepts a target organization", () => {
    const result = putJobWorkspaceRequestSchema.parse({
      organizationId: "org_target",
    });

    expect(result.organizationId).toBe("org_target");
  });

  it("accepts null for the personal workspace", () => {
    const result = putJobWorkspaceRequestSchema.parse({
      organizationId: null,
    });

    expect(result.organizationId).toBeNull();
  });
});

describe("PUT /jobs/{id}/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    jobFindFirstMock.mockResolvedValue(createOwnedJobRecord());
    jobFindUniqueMock.mockResolvedValue({ id: "job_123" });
    jobUpdateMock.mockResolvedValue({ id: "job_123" });
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: null });
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_target",
      },
      role: "member",
    });
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: ACTIVE_WORKSPACE_ID,
    });
    mapJobWithStatusMock.mockReturnValue(createJobApi());
    serializeJobDetailsMock.mockImplementation((job) => job);

    mockTransaction({
      job: {
        findFirst: jobFindFirstMock,
        findUnique: jobFindUniqueMock,
        update: jobUpdateMock,
      },
      workspace: {
        findUnique: workspaceFindUniqueMock,
      },
    });
  });

  it("moves a standalone job by updating placement only", async () => {
    const app = createApp(null);
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_target",
      userId: "user_123",
      tx: expect.any(Object),
    });
    expect(jobUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
      },
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("returns 409 for task-attached jobs", async () => {
    jobFindFirstMock.mockResolvedValue(
      createOwnedJobRecord({
        taskId: "tsk_123",
      }),
    );

    const app = createApp("org_current");
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(409);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 409 for schedule-backed jobs", async () => {
    jobFindFirstMock.mockResolvedValue(
      createOwnedJobRecord({
        jobScheduleId: "js_123",
      }),
    );

    const app = createApp("org_current");
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(409);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job is not owned by the user", async () => {
    jobFindFirstMock.mockResolvedValue(null);

    const app = createApp(null);
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(403);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the owned job is outside the active workspace", async () => {
    jobFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp("org_current");
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_target",
      }),
    });

    expect(response.status).toBe(403);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the target organization is not a current membership", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      new HTTPException(403, {
        message: "You are not a member of this organization",
      }),
    );

    const app = createApp(null);
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_forbidden",
      }),
    });

    expect(response.status).toBe(403);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("allows idempotent no-op updates without membership or write checks", async () => {
    jobFindFirstMock.mockResolvedValue(createOwnedJobRecord());
    workspaceFindUniqueMock.mockResolvedValue({
      organizationId: "org_current",
    });

    const app = createApp("org_current");
    const response = await app.request("http://localhost/job_123/workspace", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "org_current",
      }),
    });

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });
});
