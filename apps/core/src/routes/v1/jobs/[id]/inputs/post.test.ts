import { AgentStatus, JobType } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  publicWorkMadeBy,
  WORK_MAKERS,
} from "@/test-fixtures/responsible-work";

import mountPostJobInputs from "./post";

const {
  authContextState,
  prismaTransactionMock,
  jobEventFindFirstMock,
  jobFindFirstMock,
  jobInputCreateMock,
  requireAssignedOrganizationSeatMock,
  resolveMemberOrganizationByIdMock,
  workspaceFindUniqueMock,
  requireJobCollaborationMock,
  provideJobInputMock,
} = vi.hoisted(() => ({
  requireJobCollaborationMock: vi.fn(),
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
  jobEventFindFirstMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  jobInputCreateMock: vi.fn(),
  requireAssignedOrganizationSeatMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  provideJobInputMock: vi.fn(),
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

vi.mock("@/helpers/access-control.js", () => ({
  requireJobCollaboration: requireJobCollaborationMock,
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: requireAssignedOrganizationSeatMock,
}));

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: () => ({
    provideJobInput: provideJobInputMock,
  }),
}));

vi.mock("@/lib/db/prisma", async () => ({
  default: {
    member: {
      findUnique: (await import("@/test-fixtures/organization-membership"))
        .stubMemberFindUnique,
    },
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
    jobInput: {
      create: (...args: unknown[]) => jobInputCreateMock(...args),
    },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountPostJobInputs(app);
  return app;
}

function createAwaitingInputJobEvent(
  agentStatus: AgentStatus,
  jobOverrides: Record<string, unknown> = {},
) {
  return {
    id: "event_123",
    inputSchema: '{"input_data":[{"id":"answer","type":"string"}]}',
    input: null,
    job: {
      id: "job_123",
      agentJobId: "agent_job_123",
      agentBlockchainIdentifier: "agent-chain",
      agentApiBaseUrl: "https://agent.example.com",
      jobType: JobType.FREE,
      externalDisputeUnlockTime: null,
      refundedTransactionId: null,
      purchase: null,
      ...jobOverrides,
      agent: {
        id: "agent_123",
        blockchainIdentifier: "agent-chain",
        name: "Research Agent",
        apiBaseUrl: "https://agent.example.com",
        status: agentStatus,
        metadataOverride: null,
      },
    },
  };
}

const IN_FLIGHT_PAID_JOB = {
  jobType: JobType.PAID,
  externalDisputeUnlockTime: new Date(Date.now() + 60 * 60 * 1000),
};

async function postInputs(app: ReturnType<typeof createApp>) {
  return await app.request("http://localhost/job_123/inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: "event_123",
      inputData: { answer: "8" },
    }),
  });
}

describe("POST /jobs/{id}/inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireJobCollaborationMock.mockResolvedValue(undefined);
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    jobEventFindFirstMock.mockResolvedValue(
      createAwaitingInputJobEvent(AgentStatus.ONLINE),
    );
    provideJobInputMock.mockResolvedValue(
      ok({ input_hash: "input_hash_123", signature: "signature_123" }),
    );
    jobInputCreateMock.mockResolvedValue({
      id: "job_input_123",
      input: '{"answer":"8"}',
      inputHash: "input_hash_123",
      signature: "signature_123",
    });
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          job: { findFirst: typeof jobFindFirstMock };
          jobEvent: { findFirst: typeof jobEventFindFirstMock };
          workspace: { findUnique: typeof workspaceFindUniqueMock };
        }) => Promise<unknown>,
      ) => {
        return await callback({
          job: { findFirst: jobFindFirstMock },
          jobEvent: {
            findFirst: jobEventFindFirstMock,
          },
          workspace: { findUnique: workspaceFindUniqueMock },
        });
      },
    );
  });

  it("still provides input when the agent is no longer online", async () => {
    jobEventFindFirstMock.mockResolvedValue(
      createAwaitingInputJobEvent(AgentStatus.OFFLINE),
    );

    const app = createApp();
    const response = await postInputs(app);

    expect(response.status).toBe(201);
    expect(provideJobInputMock).toHaveBeenCalled();
    expect(jobInputCreateMock).toHaveBeenCalled();
  });

  it("accepts input for an in-flight paid job whose agent went offline", async () => {
    // The stable Agent row advanced to a newer, offline revision; sync still
    // polls this job (and can ask for input), so the endpoint must accept it.
    jobEventFindFirstMock.mockResolvedValue(
      createAwaitingInputJobEvent(AgentStatus.OFFLINE, IN_FLIGHT_PAID_JOB),
    );

    const app = createApp();
    const response = await postInputs(app);

    expect(response.status).toBe(201);
    expect(provideJobInputMock).toHaveBeenCalled();
  });

  it("provides input to an online agent and persists the job input", async () => {
    const app = createApp();
    const response = await postInputs(app);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(provideJobInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent_123",
        blockchainIdentifier: "agent-chain",
        apiBaseUrl: "https://agent.example.com",
      }),
      "agent_job_123",
      '{"input_data":[{"id":"answer","type":"string"}]}',
      { answer: "8" },
    );
    expect(jobInputCreateMock).toHaveBeenCalledWith({
      data: {
        event: { connect: { id: "event_123" } },
        input: '{"answer":"8"}',
        inputHash: "input_hash_123",
        signature: "signature_123",
      },
    });
    expect(body.data).toEqual({
      id: "job_input_123",
      input: '{"answer":"8"}',
      inputHash: "input_hash_123",
      signature: "signature_123",
    });
  });

  it("uses typed seller failure message in validation response", async () => {
    provideJobInputMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "Seller response lost" }),
    );

    const response = await postInputs(createApp());
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(body).toBe("Seller response lost");
  });

  describe("who may answer a job's input request (ADR 0056)", () => {
    beforeEach(async () => {
      const actual = await vi.importActual<
        typeof import("@/helpers/access-control")
      >("@/helpers/access-control");
      requireJobCollaborationMock.mockImplementation(
        actual.requireJobCollaboration,
      );
      workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_123" });
      resolveMemberOrganizationByIdMock.mockResolvedValue({
        organization: { id: "org_123" },
        role: "member",
      });
      requireAssignedOrganizationSeatMock.mockResolvedValue(undefined);
    });

    function standaloneJob(columns: ReturnType<typeof publicWorkMadeBy>) {
      return {
        id: "job_123",
        taskId: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        ...columns,
      };
    }

    it.each(WORK_MAKERS)(
      "lets the responsible person answer for a job made by a %s",
      async (maker) => {
        jobFindFirstMock.mockResolvedValue(
          standaloneJob(publicWorkMadeBy(maker, "user_123")),
        );

        const response = await postInputs(createApp());

        expect(response.status).toBe(201);
        expect(provideJobInputMock).toHaveBeenCalled();
      },
    );

    it.each(WORK_MAKERS)(
      "refuses anyone else a job made by a %s",
      async (maker) => {
        jobFindFirstMock.mockResolvedValue(
          standaloneJob(publicWorkMadeBy(maker, "user_other")),
        );

        const response = await postInputs(createApp());

        expect(response.status).toBe(403);
        expect(provideJobInputMock).not.toHaveBeenCalled();
      },
    );

    it("lets any seated member answer for a job nobody is responsible for", async () => {
      jobFindFirstMock.mockResolvedValue(
        standaloneJob(publicWorkMadeBy("sokoBot", null)),
      );

      const response = await postInputs(createApp());

      expect(response.status).toBe(201);
      expect(provideJobInputMock).toHaveBeenCalled();
    });

    it("refuses a member without a seat a job nobody is responsible for", async () => {
      jobFindFirstMock.mockResolvedValue(
        standaloneJob(publicWorkMadeBy("sokoBot", null)),
      );
      requireAssignedOrganizationSeatMock.mockImplementation(async () => {
        throw forbidden(
          "An assigned seat is required to use this organization",
        );
      });

      const response = await postInputs(createApp());

      expect(response.status).toBe(403);
      expect(provideJobInputMock).not.toHaveBeenCalled();
    });
  });
});
