import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { JobErrorCode } from "@/lib/actions/errors/error-codes/job";

const sentrySetTagMock = vi.fn();
const sentrySetContextMock = vi.fn();

vi.mock("@/lib/actions", () => ({
  CommonErrorCode,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  withScope: async (
    callback: (scope: {
      setTag: typeof vi.fn;
      setContext: typeof vi.fn;
    }) => Promise<unknown> | unknown,
  ) =>
    await callback({
      setTag: sentrySetTagMock,
      setContext: sentrySetContextMock,
    }),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) => {
      const nextParams =
        "session" in params
          ? params
          : {
              ...params,
              session: {
                user: { id: "user-1", email: "ada@example.com" },
                session: { activeOrganizationId: null },
              },
            };

      return await handler(nextParams as TParams);
    },
}));

const patchJobMock = vi.fn();
const provideJobInputCoreMock = vi.fn();
const requestJobRefundMock = vi.fn();
const createAgentJobMock = vi.fn();
const getAgentByIdMock = vi.fn();
const getMyCreditsMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();
const callAgentHiredWebHookMock = vi.fn();

class MockCoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    createAgentJob: (...args: unknown[]) => createAgentJobMock(...args),
    getAgentById: (...args: unknown[]) => getAgentByIdMock(...args),
    getMyCredits: (...args: unknown[]) => getMyCreditsMock(...args),
    patchJob: (...args: unknown[]) => patchJobMock(...args),
    provideJobInput: (...args: unknown[]) => provideJobInputCoreMock(...args),
    requestJobRefund: (...args: unknown[]) => requestJobRefundMock(...args),
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

vi.mock("@/lib/services", () => ({
  callAgentHiredWebHook: (...args: unknown[]) =>
    callAgentHiredWebHookMock(...args),
  jobService: {
    moveJobToWorkspace: vi.fn(),
    provideJobInput: vi.fn(),
  },
}));

describe("startJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to communicate with Core API",
    });
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 0,
      },
    });
    getMyCreditsMock.mockResolvedValue({
      data: {
        subscription: {
          credits: {
            remaining: 100,
          },
        },
      },
    });
  });

  it("creates an immediate job through the core client", async () => {
    createAgentJobMock.mockResolvedValue({
      data: {
        id: "job-1",
      },
    });

    const { startJob } = await import("../action");
    const { revalidatePath } = await import("next/cache");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
      session: {
        user: { id: "user-1", email: "ada@example.com" },
        session: { activeOrganizationId: "org-1" },
      } as never,
    });

    expect(createAgentJobMock).toHaveBeenCalledWith("agent-1", {
      inputSchema: { input_data: [] },
      inputData: { prompt: "hello" },
      maxCredits: 1,
    });
    expect(createAgentJobMock.mock.calls[0][1]).not.toHaveProperty("name");
    expect(getAgentByIdMock).toHaveBeenCalledWith("agent-1");
    expect(callAgentHiredWebHookMock).toHaveBeenCalledWith(
      "user-1",
      "ada@example.com",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/agents/agent-1/jobs/job-1",
      "layout",
    );
    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "job-1",
      },
    });
  });

  it("passes projectId to core when starting a job for a project", async () => {
    createAgentJobMock.mockResolvedValue({
      data: {
        id: "job-project",
      },
    });

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
        projectId: " project-1 ",
      },
      session: {
        user: { id: "user-1", email: "ada@example.com" },
        session: { activeOrganizationId: "org-1" },
      } as never,
    });

    expect(createAgentJobMock).toHaveBeenCalledWith("agent-1", {
      inputSchema: { input_data: [] },
      inputData: { prompt: "hello" },
      maxCredits: 1,
      projectId: "project-1",
    });
    expect(createAgentJobMock.mock.calls[0][1]).not.toHaveProperty("name");
    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "job-project",
      },
    });
  });

  it("returns cost too high when maxAcceptedCents is zero but the agent has a positive credits price", async () => {
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 2.5,
      },
    });

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(0),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
      session: {
        user: { id: "user-1", email: "ada@example.com" },
        session: { activeOrganizationId: "org-1" },
      } as never,
    });

    expect(createAgentJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Credit cost is too high",
        code: JobErrorCode.COST_TOO_HIGH,
      },
    });
  });

  it("returns cost too high when maxAcceptedCents is zero and agent credits cannot be resolved", async () => {
    getAgentByIdMock.mockRejectedValue(new Error("Core timeout"));

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(0),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
      session: {
        user: { id: "user-1", email: "ada@example.com" },
        session: { activeOrganizationId: "org-1" },
      } as never,
    });

    expect(createAgentJobMock).not.toHaveBeenCalled();
    expect(sentrySetTagMock).toHaveBeenCalledWith(
      "error_type",
      "job_start_agent_fetch_failed",
    );
    expect(sentrySetContextMock).toHaveBeenCalledWith(
      "job_start_agent_fetch",
      expect.objectContaining({
        agentId: "agent-1",
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Credit cost is too high",
        code: JobErrorCode.COST_TOO_HIGH,
      },
    });
  });

  it("omits maxCredits when maxAcceptedCents is zero and the agent is free (Core rejects maxCredits: 0)", async () => {
    createAgentJobMock.mockResolvedValue({
      data: {
        id: "job-zero-max",
      },
    });

    const { startJob } = await import("../action");
    await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(0),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
      session: {
        user: { id: "user-1", email: "ada@example.com" },
        session: { activeOrganizationId: "org-1" },
      } as never,
    });

    expect(createAgentJobMock).toHaveBeenCalledWith("agent-1", {
      inputSchema: { input_data: [] },
      inputData: { prompt: "hello" },
    });
    expect(createAgentJobMock.mock.calls[0][1]).not.toHaveProperty("name");
    expect(createAgentJobMock.mock.calls[0][1]).not.toHaveProperty(
      "maxCredits",
    );
  });

  it("returns bad input before calling core when validation fails", async () => {
    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: 500,
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    } as never);

    expect(createAgentJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      },
    });
  });

  it("maps insufficient balance core errors to the existing job error code", async () => {
    createAgentJobMock.mockRejectedValue(
      new MockCoreApiRequestError("Insufficient balance", { status: 400 }),
    );

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Insufficient balance",
        code: JobErrorCode.INSUFFICIENT_BALANCE,
      },
    });
  });

  it("returns insufficient balance before createAgentJob when preflight balance is lower than agent credits", async () => {
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 2.5,
      },
    });
    getMyCreditsMock.mockResolvedValue({
      data: {
        subscription: {
          credits: {
            remaining: 1.9,
          },
        },
      },
    });

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(createAgentJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Insufficient balance",
        code: JobErrorCode.INSUFFICIENT_BALANCE,
      },
    });
  });

  it("uses extra credits remaining for preflight when subscription is null", async () => {
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 2.5,
      },
    });
    getMyCreditsMock.mockResolvedValue({
      data: {
        subscription: null,
        credits: {
          subscription: null,
          buffer: 3,
          total: 3,
        },
        extra: {
          credits: { total: 3, remaining: 3, used: 0 },
          buckets: [],
        },
      },
    });
    createAgentJobMock.mockResolvedValue({
      data: {
        id: "job-addon-credits",
      },
    });

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(createAgentJobMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "job-addon-credits",
      },
    });
  });

  it("sums subscription and extra remaining credits for preflight", async () => {
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 5.5,
      },
    });
    getMyCreditsMock.mockResolvedValue({
      data: {
        subscription: {
          credits: {
            remaining: 2,
          },
        },
        extra: {
          credits: { total: 4, remaining: 4, used: 0 },
          buckets: [],
        },
      },
    });
    createAgentJobMock.mockResolvedValue({
      data: {
        id: "job-summed-credits",
      },
    });

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(createAgentJobMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "job-summed-credits",
      },
    });
  });

  it("fails closed when credit preflight cannot verify balance for a paid agent", async () => {
    getAgentByIdMock.mockResolvedValue({
      data: {
        name: "Research Agent",
        description: "Researches topics",
        credits: 2.5,
      },
    });
    getMyCreditsMock.mockRejectedValue(new Error("Credits API unavailable"));

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(createAgentJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Failed to verify credit balance",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    });
  });

  it("maps other client-side core errors to AGENT_JOB_START_FAILED", async () => {
    createAgentJobMock.mockRejectedValue(
      new MockCoreApiRequestError("Duplicate job", { status: 400 }),
    );

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(toCoreApiActionErrorMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Duplicate job",
        code: JobErrorCode.AGENT_JOB_START_FAILED,
      },
    });
  });

  it("maps core 5xx errors through toCoreApiActionError", async () => {
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Upstream failure",
    });
    createAgentJobMock.mockRejectedValue(
      new MockCoreApiRequestError("Bad gateway", { status: 502 }),
    );

    const { startJob } = await import("../action");
    const result = await startJob({
      input: {
        agentId: "agent-1",
        maxAcceptedCents: BigInt(10_000_000_000),
        inputSchema: { input_data: [] },
        inputData: { prompt: "hello" },
      },
    });

    expect(toCoreApiActionErrorMock).toHaveBeenCalledWith(expect.any(Error));
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Upstream failure",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    });
  });
});

describe("updateJobName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to communicate with Core API",
    });
  });

  it("updates the job name through the core client", async () => {
    patchJobMock.mockResolvedValue({ data: { id: "job-1" } });

    const { updateJobName } = await import("../action");
    const result = await updateJobName({
      jobId: "job-1",
      data: { name: "Renamed Job" },
    });

    expect(patchJobMock).toHaveBeenCalledWith("job-1", {
      name: "Renamed Job",
    });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("normalizes an empty name to null before calling core", async () => {
    patchJobMock.mockResolvedValue({ data: { id: "job-1" } });

    const { updateJobName } = await import("../action");
    await updateJobName({
      jobId: "job-1",
      data: { name: "" },
    });

    expect(patchJobMock).toHaveBeenCalledWith("job-1", {
      name: null,
    });
  });

  it("returns bad input when validation fails", async () => {
    const { updateJobName } = await import("../action");
    const result = await updateJobName({
      jobId: "job-1",
      data: { name: "a" },
    });

    expect(patchJobMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      },
    });
  });

  it.each([401, 403])(
    "returns unauthorized when core rejects with %i",
    async (status) => {
      patchJobMock.mockRejectedValue(
        new MockCoreApiRequestError("Unauthorized", { status }),
      );

      const { updateJobName } = await import("../action");
      const result = await updateJobName({
        jobId: "job-1",
        data: { name: "Renamed Job" },
      });

      expect(result).toEqual({
        ok: false,
        error: {
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        },
      });
    },
  );

  it("returns job not found when core returns 404", async () => {
    patchJobMock.mockRejectedValue(
      new MockCoreApiRequestError("Job not found", { status: 404 }),
    );

    const { updateJobName } = await import("../action");
    const result = await updateJobName({
      jobId: "job-1",
      data: { name: "Renamed Job" },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      },
    });
  });

  it("falls back to generic core error mapping for other failures", async () => {
    patchJobMock.mockRejectedValue(new Error("service unavailable"));
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "The service is currently unavailable.",
    });

    const { updateJobName } = await import("../action");
    const result = await updateJobName({
      jobId: "job-1",
      data: { name: "Renamed Job" },
    });

    expect(toCoreApiActionErrorMock).toHaveBeenCalledWith(expect.any(Error));
    expect(result).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "The service is currently unavailable.",
      },
    });
  });
});

describe("requestRefundJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to communicate with Core API",
    });
  });

  it("requests the refund through core and returns the updated paid job status", async () => {
    requestJobRefundMock.mockResolvedValue({
      data: {
        id: "job-1",
        jobType: "PAID",
        status: "refund_pending",
      },
    });

    const { requestRefundJob } = await import("../action");
    const result = await requestRefundJob({
      jobId: "job-1",
    });

    expect(requestJobRefundMock).toHaveBeenCalledWith("job-1");
    expect(result).toEqual({
      ok: true,
      data: {
        job: {
          id: "job-1",
          jobType: "PAID",
          status: "refund_pending",
        },
      },
    });
  });

  it("returns unauthorized when core rejects with 401 or 403", async () => {
    const { requestRefundJob } = await import("../action");

    for (const status of [401, 403]) {
      requestJobRefundMock.mockRejectedValueOnce(
        new MockCoreApiRequestError("Unauthorized", { status }),
      );

      const result = await requestRefundJob({
        jobId: `job-${status}`,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        },
      });
    }
  });

  it("returns job not found when core returns 404", async () => {
    requestJobRefundMock.mockRejectedValue(
      new MockCoreApiRequestError("Job not found", { status: 404 }),
    );

    const { requestRefundJob } = await import("../action");
    const result = await requestRefundJob({
      jobId: "job-1",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      },
    });
  });

  it("maps a 422 core error through the shared core error mapper", async () => {
    requestJobRefundMock.mockRejectedValue(
      new MockCoreApiRequestError("Refund failed", { status: 422 }),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.BAD_INPUT,
      message: "Refund failed",
    });

    const { requestRefundJob } = await import("../action");
    const result = await requestRefundJob({
      jobId: "job-1",
    });

    expect(toCoreApiActionErrorMock).toHaveBeenCalledWith(expect.any(Error));
    expect(result).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Refund failed",
      },
    });
  });

  it("returns job not found when core returns a non-paid job", async () => {
    requestJobRefundMock.mockResolvedValue({
      data: {
        id: "job-1",
        jobType: "FREE",
        status: "refund_pending",
      },
    });

    const { requestRefundJob } = await import("../action");
    const result = await requestRefundJob({
      jobId: "job-1",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Job not found",
        code: JobErrorCode.JOB_NOT_FOUND,
      },
    });
  });
});

describe("provideJobInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits input through the core client and returns the job id", async () => {
    provideJobInputCoreMock.mockResolvedValue({
      data: { id: "input-1", input: "{}", inputHash: "h", signature: "s" },
    });

    const { provideJobInput } = await import("../action");
    const result = await provideJobInput({
      input: {
        jobId: "job-1",
        eventId: "event-1",
        inputData: { answer: "8" },
      },
    });

    expect(provideJobInputCoreMock).toHaveBeenCalledWith("job-1", {
      eventId: "event-1",
      inputData: { answer: "8" },
    });
    expect(result).toEqual({ ok: true, data: { jobId: "job-1" } });
  });

  it("returns BAD_INPUT and skips core for input it cannot narrow", async () => {
    const { provideJobInput } = await import("../action");
    const result = await provideJobInput({
      input: {
        jobId: "job-1",
        eventId: "event-1",
        inputData: { attachment: new File(["x"], "x.txt") },
      },
    });

    expect(provideJobInputCoreMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { message: "Bad Input", code: CommonErrorCode.BAD_INPUT },
    });
  });

  it("maps a core request error to an action error", async () => {
    provideJobInputCoreMock.mockRejectedValue(
      new MockCoreApiRequestError("not found", { status: 404 }),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      code: CommonErrorCode.NOT_FOUND,
      message: "not found",
    });

    const { provideJobInput } = await import("../action");
    const result = await provideJobInput({
      input: {
        jobId: "job-1",
        eventId: "event-1",
        inputData: { answer: "8" },
      },
    });

    expect(toCoreApiActionErrorMock).toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.NOT_FOUND, message: "not found" },
    });
  });
});
