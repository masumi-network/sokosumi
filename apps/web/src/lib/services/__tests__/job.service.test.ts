import { InputType } from "@sokosumi/masumi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createDemoJobMock = vi.fn();
const upsertWorkspaceForContextMock = vi.fn();
const publishJobStatusDataMock = vi.fn();
const getAvailableAgentByIdMock = vi.fn();
const getActiveOrganizationIdMock = vi.fn();
const prismaTransactionMock = vi.fn();
const moveJobToWorkspaceCoreMock = vi.fn();
const createDemoJobCoreMock = vi.fn();
const getJobsCoreMock = vi.fn();
const getLatestJobByAgentIdUserIdAndWorkspaceMock = vi.fn();
const getSessionMock = vi.fn();
const getJobStatusDataMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  withScope: async (
    callback: (scope: {
      setTag: typeof vi.fn;
      setContext: typeof vi.fn;
    }) => unknown,
  ) =>
    await callback({
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
}));

vi.mock("uuid", () => ({
  v4: () => "12345678-1234-4234-9234-1234567890ab",
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobEventRepository: {},
  jobInputRepository: {},
  jobRepository: {
    createDemoJob: (...args: unknown[]) => createDemoJobMock(...args),
    getLatestJobByAgentIdUserIdAndWorkspace: (...args: unknown[]) =>
      getLatestJobByAgentIdUserIdAndWorkspaceMock(...args),
  },
  workspaceRepository: {
    upsertWorkspaceForContext: (...args: unknown[]) =>
      upsertWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/lib/ably/publish", () => ({
  default: (...args: unknown[]) => publishJobStatusDataMock(...args),
}));

vi.mock("@/lib/clients", () => ({
  agentClient: {
    provideJobInput: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getJobs: (...args: unknown[]) => getJobsCoreMock(...args),
    moveJobToWorkspace: (...args: unknown[]) =>
      moveJobToWorkspaceCoreMock(...args),
    createDemoJob: (...args: unknown[]) => createDemoJobCoreMock(...args),
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("@/lib/helpers/job", () => ({
  getJobStatusData: (...args: unknown[]) => getJobStatusDataMock(...args),
}));

vi.mock("../agent.service", () => ({
  agentService: {
    getAvailableAgentById: (...args: unknown[]) =>
      getAvailableAgentByIdMock(...args),
  },
}));

vi.mock("../user.service", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
  },
}));

vi.mock("@/lib/services/agent.service", () => ({
  agentService: {
    getAvailableAgentById: (...args: unknown[]) =>
      getAvailableAgentByIdMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
  },
}));

function buildStartInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_123",
    organizationId: "org_123",
    agentId: "agent_123",
    inputData: {
      prompt: "hello",
    },
    inputSchema: {
      input_data: [
        {
          id: "prompt",
          type: InputType.STRING,
          name: "Prompt",
        },
      ],
    },
    maxAcceptedCents: BigInt(10),
    ...overrides,
  } as never;
}

describe("job.service workspace persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_123",
      },
      session: {
        activeOrganizationId: "org_123",
      },
    });
    publishJobStatusDataMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          tx: "transaction",
        });
      },
    );
  });

  it("creates demo jobs through the core client", async () => {
    createDemoJobCoreMock.mockResolvedValue({ data: { id: "job_demo" } });

    const { jobService } = await import("../job.service");

    const result = await jobService.startDemoJob(
      buildStartInput({ organizationId: null }),
      { result: "demo result" } as never,
    );

    expect(createDemoJobCoreMock).toHaveBeenCalledWith("agent_123", {
      inputData: { prompt: "hello" },
      inputSchema: {
        input_data: [
          {
            id: "prompt",
            type: InputType.STRING,
            name: "Prompt",
          },
        ],
      },
      result: "demo result",
    });
    // Demo job creation no longer touches the database directly.
    expect(createDemoJobMock).not.toHaveBeenCalled();
    expect(upsertWorkspaceForContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "job_demo" });
  });

  it("rejects demo jobs whose input cannot be sent to core (e.g. File values)", async () => {
    const { jobService } = await import("../job.service");

    await expect(
      jobService.startDemoJob(
        buildStartInput({
          inputData: { attachment: new File(["x"], "x.txt") },
        }),
        { result: "demo result" } as never,
      ),
    ).rejects.toThrow();
    expect(createDemoJobCoreMock).not.toHaveBeenCalled();
  });

  it("moves standalone jobs through the core client", async () => {
    moveJobToWorkspaceCoreMock.mockResolvedValue({
      data: {
        id: "job_123",
      },
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.moveJobToWorkspace("job_123", "org_456");

    expect(moveJobToWorkspaceCoreMock).toHaveBeenCalledWith("job_123", {
      organizationId: "org_456",
    });
    expect(result).toEqual({
      id: "job_123",
    });
  });

  it("loads recent job statuses from Core for each agent", async () => {
    getJobsCoreMock.mockResolvedValue({
      data: [
        {
          id: "job_123",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          agentId: "agent_123",
          userId: "user_123",
          jobType: "PAID",
          status: "PROCESSING",
          credits: 0,
          user: { id: "user_123", name: "User", image: null },
          workspace: {
            id: "workspace-1",
            organizationId: "org_123",
            organization: {
              id: "org_123",
              name: "Org",
              slug: "org",
            },
          },
        },
      ],
    });
    getJobStatusDataMock.mockReturnValue({
      id: "job_123",
      status: "processing",
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.getJobStatusesDataForAgents(["agent_123"]);

    expect(getJobsCoreMock).toHaveBeenCalledWith({
      agentId: "agent_123",
      scope: "owned",
      limit: 1,
    });
    expect(upsertWorkspaceForContextMock).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: "job_123",
        status: "processing",
      },
    ]);
  });
});
