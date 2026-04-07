import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: async (callback: (scope: Record<string, unknown>) => unknown) =>
    await callback({
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
    BAD_INPUT: "BAD_INPUT",
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      await handler(params),
}));

const canMutateOwnedJobInActiveWorkspaceMock = vi.fn();
const getJobWorkspaceContextMock = vi.fn();
const provideJobInputMock = vi.fn();
const requestRefundMock = vi.fn();
const getJobByIdMock = vi.fn();
const getJobByBlockchainIdentifierMock = vi.fn();
const updateJobNameByIdMock = vi.fn();

vi.mock("@/lib/auth/job-access", () => ({
  canMutateOwnedJobInActiveWorkspace: (...args: unknown[]) =>
    canMutateOwnedJobInActiveWorkspaceMock(...args),
  getJobWorkspaceContext: (...args: unknown[]) =>
    getJobWorkspaceContextMock(...args),
}));

vi.mock("@/lib/services", () => ({
  callAgentHiredWebHook: vi.fn(),
  jobService: {
    provideJobInput: (...args: unknown[]) => provideJobInputMock(...args),
    requestRefund: (...args: unknown[]) => requestRefundMock(...args),
    startDemoJob: vi.fn(),
    startJob: vi.fn(),
    moveJobToWorkspace: vi.fn(),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : "core error",
  })),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
    getJobByBlockchainIdentifier: (...args: unknown[]) =>
      getJobByBlockchainIdentifierMock(...args),
    updateJobNameById: (...args: unknown[]) => updateJobNameByIdMock(...args),
  },
  userRepository: {
    getUserById: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

const session = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: "org-1",
  },
} as never;

describe("job actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getJobWorkspaceContextMock.mockReturnValue({
      userId: "user-1",
      activeOrganizationId: "org-1",
    });
  });

  it("rejects job renames outside the active workspace scope", async () => {
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      workspaceId: "workspace-2",
    });
    canMutateOwnedJobInActiveWorkspaceMock.mockResolvedValue(false);

    const { updateJobName } = await import("../action");
    const result = await updateJobName({
      jobId: "job-1",
      data: {
        name: "Scoped name",
      },
      session,
    });

    expect(canMutateOwnedJobInActiveWorkspaceMock).toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
    expect(updateJobNameByIdMock).not.toHaveBeenCalled();
  });

  it("passes the active organization into provideJobInput", async () => {
    provideJobInputMock.mockResolvedValue({
      job: {
        id: "job-1",
        agentId: "agent-1",
      },
      jobEvent: {
        id: "event-1",
      },
    });

    const { provideJobInput } = await import("../action");
    const result = await provideJobInput({
      input: {
        jobId: "job-1",
        eventId: "event-1",
        inputData: {
          answer: "8",
        },
      },
      session,
    });

    expect(provideJobInputMock).toHaveBeenCalledWith({
      jobId: "job-1",
      eventId: "event-1",
      userId: "user-1",
      activeOrganizationId: "org-1",
      inputData: {
        answer: "8",
      },
    });
    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "job-1",
      },
    });
  });

  it("rejects refund requests outside the active workspace scope", async () => {
    getJobByBlockchainIdentifierMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      workspaceId: "workspace-2",
      blockchainIdentifier: "chain-1",
    });
    canMutateOwnedJobInActiveWorkspaceMock.mockResolvedValue(false);

    const { requestRefundJobByBlockchainIdentifier } = await import(
      "../action"
    );
    const result = await requestRefundJobByBlockchainIdentifier({
      blockchainIdentifier: "chain-1",
      session,
    });

    expect(requestRefundMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      },
    });
  });
});
