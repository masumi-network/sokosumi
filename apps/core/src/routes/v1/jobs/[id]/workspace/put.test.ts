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
  upsertWorkspaceForContextMock,
  serializeJobDetailsMock,
} = vi.hoisted(() => ({
  jobFindFirstMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  mapJobWithStatusMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  upsertWorkspaceForContextMock: vi.fn(),
  serializeJobDetailsMock: vi.fn(),
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
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertWorkspaceForContext: upsertWorkspaceForContextMock,
  },
}));

vi.mock("@/types/job", () => ({
  serializeJobDetails: serializeJobDetailsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

interface CurrentJobRecord {
  id: string;
  ownerId: string;
  organizationId: string | null;
  taskId: string | null;
  workspaceId: string;
  workspace: {
    organizationId: string | null;
  };
}

interface TransactionMock {
  job: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  task?: {
    findFirst: ReturnType<typeof vi.fn>;
  };
}

function createCurrentJobRecord(
  overrides: Partial<CurrentJobRecord> = {},
): CurrentJobRecord {
  return {
    id: "job_123",
    ownerId: "user_123",
    organizationId: "org_billing",
    taskId: null,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    workspace: {
      organizationId: null,
    },
    ...overrides,
  };
}

function createJobApi(overrides: Partial<Record<string, unknown>> = {}) {
  const owner = {
    id: "user_123",
    name: "Ada Lovelace",
    image: null,
  };

  return {
    id: "job_123",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    completedAt: null,
    agentId: "agent_123",
    ownerId: "user_123",
    owner,
    userId: "user_123",
    organizationId: "org_billing",
    projectId: null,
    taskId: null,
    name: "Current job",
    jobType: "PAID",
    status: "processing",
    credits: 5,
    jobStatusSettled: false,
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
    user: owner,
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
    share: null,
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
      role: "user",
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

    jobFindFirstMock.mockResolvedValue(createCurrentJobRecord());
    jobFindUniqueMock.mockResolvedValue({ id: "job_123" });
    jobUpdateMock.mockResolvedValue({ id: "job_123" });
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: {
        id: "org_target",
      },
      role: "member",
    });
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mapJobWithStatusMock.mockReturnValue(createJobApi());
    serializeJobDetailsMock.mockImplementation((job) => job);

    mockTransaction({
      job: {
        findFirst: jobFindFirstMock,
        findUnique: jobFindUniqueMock,
        update: jobUpdateMock,
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
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        ownerId: "user_123",
      },
      select: {
        taskId: true,
        workspace: {
          select: {
            organizationId: true,
          },
        },
      },
    });
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
        projectId: null,
      },
    });
  });

  it("returns 409 for task-attached jobs", async () => {
    jobFindFirstMock.mockResolvedValue(
      createCurrentJobRecord({
        taskId: "tsk_123",
      }),
    );
    const taskFindFirstMock = vi
      .fn()
      .mockResolvedValue({ pendingVendorGrantId: null });

    mockTransaction({
      job: {
        findFirst: jobFindFirstMock,
        findUnique: jobFindUniqueMock,
        update: jobUpdateMock,
      },
      task: {
        findFirst: taskFindFirstMock,
      },
    });

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
    jobFindFirstMock.mockResolvedValue(
      createCurrentJobRecord({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspace: {
          organizationId: "org_current",
        },
      }),
    );

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
