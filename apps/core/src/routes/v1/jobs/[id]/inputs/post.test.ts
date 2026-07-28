import { AgentStatus } from "@sokosumi/database";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostJobInputs from "./post";

const {
  authContextState,
  prismaTransactionMock,
  jobEventFindFirstMock,
  jobInputCreateMock,
  requireJobCollaborationMock,
  provideJobInputMock,
} = vi.hoisted(() => ({
  requireJobCollaborationMock: vi.fn(async () => undefined),
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
  jobInputCreateMock: vi.fn(),
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
  isOrchestratorAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "orchestrator",
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireJobCollaboration: requireJobCollaborationMock,
}));

vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: () => ({
    provideJobInput: provideJobInputMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
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

function createAwaitingInputJobEvent(agentStatus: AgentStatus) {
  return {
    id: "event_123",
    inputSchema: '{"input_data":[{"id":"answer","type":"string"}]}',
    input: null,
    job: {
      id: "job_123",
      agentJobId: "agent_job_123",
      agentBlockchainIdentifier: "agent-chain",
      agentApiBaseUrl: "https://agent.example.com",
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
          jobEvent: { findFirst: typeof jobEventFindFirstMock };
        }) => Promise<unknown>,
      ) => {
        return await callback({
          jobEvent: {
            findFirst: jobEventFindFirstMock,
          },
        });
      },
    );
  });

  it("returns 422 without contacting the agent when it is not online", async () => {
    jobEventFindFirstMock.mockResolvedValue(
      createAwaitingInputJobEvent(AgentStatus.OFFLINE),
    );

    const app = createApp();
    const response = await postInputs(app);

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Agent is no longer available");
    expect(provideJobInputMock).not.toHaveBeenCalled();
    expect(jobInputCreateMock).not.toHaveBeenCalled();
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
});
