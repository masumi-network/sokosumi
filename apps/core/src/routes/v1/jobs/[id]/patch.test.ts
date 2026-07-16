import { AgentJobStatus, JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { patchJobRequestSchema } from "@/schemas/job.schema";

import mountPatchJobById from "./patch";

const {
  authContextState,
  prismaTransactionMock,
  jobUpdateMock,
  mapJobWithStatusMock,
  serializeJobDetailsMock,
  requireJobCollaborationMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    } as {
      actor: "user";
      userId: string;
      organizationId: string | null;
      role: string;
    } | null,
  },
  prismaTransactionMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  mapJobWithStatusMock: vi.fn(),
  serializeJobDetailsMock: vi.fn(),
  requireJobCollaborationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireJobCollaboration: requireJobCollaborationMock,
}));

vi.mock("@/middleware/auth", () => ({
  authMiddleware: async (
    c: {
      json: (body: unknown, status: number) => unknown;
      req: { path: string; method: string };
      set: (key: string, value: unknown) => void;
    },
    next: () => Promise<unknown>,
  ) => {
    if (!authContextState.current) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Unauthorized",
          meta: {
            timestamp: new Date().toISOString(),
            requestId: "req_123",
            path: c.req.path,
            method: c.req.method,
          },
        },
        401,
      );
    }

    c.set("isAuthenticated", true);
    c.set("authContext", authContextState.current);
    return await next();
  },
  requireUserContext: (authContext: unknown) => {
    const a = authContext as {
      actor: string;
      userId: string;
      organizationId: string | null;
      role: string;
      context?: { userId: string; organizationId: string | null };
    };
    if (a.actor === "user") {
      return {
        source: "session" as const,
        actor: "user",
        userId: a.userId,
        organizationId: a.organizationId,
        role: a.role,
      };
    }
    if (a.actor === "coworker" && a.context) {
      return {
        source: "context" as const,
        userId: a.context.userId,
        organizationId: a.context.organizationId,
      };
    }
    throw new Error("mock requireUserContext: unsupported auth context");
  },
  isUserAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "user",
  isCoworkerAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "coworker",
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    mapJobWithStatus: (...args: unknown[]) => mapJobWithStatusMock(...args),
  };
});

vi.mock("@/types/job", () => ({
  serializeJobDetails: (...args: unknown[]) => serializeJobDetailsMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createSerializedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_123",
    createdAt: "2026-03-26T10:00:00.000Z",
    updatedAt: "2026-03-26T10:05:00.000Z",
    completedAt: null,
    agentId: "agent_123",
    userId: "user_123",
    organizationId: "org_123",
    projectId: null,
    taskId: null,
    name: "Renamed job",
    jobType: JobType.PAID,
    status: SokosumiJobStatus.PROCESSING,
    credits: 5,
    jobStatusSettled: false,
    onChainStatus: null,
    onChainTransactionHash: null,
    result: null,
    resultHash: null,
    input: "{}",
    inputHash: null,
    inputSchema: null,
    agentJobId: "agent_job_123",
    identifierFromPurchaser: null,
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Acme Labs",
        slug: "acme-labs",
      },
    },
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    organization: {
      id: "org_123",
      name: "Acme Labs",
      slug: "acme-labs",
    },
    agent: {
      id: "agent_123",
      name: "Research Agent",
      overrideName: null,
      icon: null,
      image: null,
      overrideImage: null,
      legalPrivacyPolicy: null,
      overrideLegalPrivacyPolicy: null,
      legalTerms: null,
      overrideLegalTerms: null,
      legalDpa: null,
      overrideLegalDpa: null,
      legalOther: null,
      overrideLegalOther: null,
    },
    events: [
      {
        id: "event_1",
        createdAt: "2026-03-26T10:00:00.000Z",
        updatedAt: "2026-03-26T10:00:00.000Z",
        status: AgentJobStatus.INITIATED,
        inputSchema: null,
        input: null,
        result: null,
        blobs: [],
        links: [],
      },
    ],
    share: null,
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountPatchJobById(app);
  return app;
}

describe("patchJobRequestSchema", () => {
  it("trims string names before length checks", () => {
    const result = patchJobRequestSchema.parse({ name: "  My job  " });
    expect(result.name).toBe("My job");
  });

  it("rejects whitespace-only strings (use null to clear the name)", () => {
    expect(() => patchJobRequestSchema.parse({ name: "   " })).toThrow();
  });

  it("accepts null to clear the name", () => {
    const result = patchJobRequestSchema.parse({ name: null });
    expect(result.name).toBeNull();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      patchJobRequestSchema.parse({ name: "ok", extra: 1 }),
    ).toThrow();
  });
});

describe("PATCH /jobs/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            update: jobUpdateMock,
          },
        }),
    );
    requireJobCollaborationMock.mockResolvedValue({
      id: "job_123",
      userId: "user_123",
      taskId: null,
    });
    jobUpdateMock.mockResolvedValue({ id: "job_123" });
    mapJobWithStatusMock.mockReturnValue({});
    serializeJobDetailsMock.mockReturnValue(createSerializedJob());
  });

  it("updates the name of an owned job", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Renamed job" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job_123" },
        data: { name: "Renamed job" },
        include: expect.any(Object),
      }),
    );
    expect(body.data).toMatchObject({
      id: "job_123",
      name: "Renamed job",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    authContextState.current = null;
    const app = createApp();

    const response = await app.request("http://localhost/job_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Renamed job" }),
    });

    expect(response.status).toBe(401);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job is owned by another user", async () => {
    requireJobCollaborationMock.mockReset();
    requireJobCollaborationMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Renamed job" }),
    });

    expect(response.status).toBe(403);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job does not exist (no existence leak)", async () => {
    requireJobCollaborationMock.mockReset();
    requireJobCollaborationMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Renamed job" }),
    });

    expect(response.status).toBe(403);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });
});
