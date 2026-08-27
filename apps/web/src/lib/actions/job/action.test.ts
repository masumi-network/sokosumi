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
const toCoreApiActionErrorMock = vi.fn();

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
    patchJob: (...args: unknown[]) => patchJobMock(...args),
    provideJobInput: (...args: unknown[]) => provideJobInputCoreMock(...args),
    requestJobRefund: (...args: unknown[]) => requestJobRefundMock(...args),
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

vi.mock("@/lib/services", () => ({
  jobService: {
    moveJobToWorkspace: vi.fn(),
    provideJobInput: vi.fn(),
  },
}));

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

    const { updateJobName } = await import("./action");
    const result = await updateJobName({
      jobId: "job-1",
      data: { name: "Renamed Job" },
    });

    expect(patchJobMock).toHaveBeenCalledWith("job-1", {
      name: "Renamed Job",
    });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("normalizes an empty name to null before calling core", async () => {
    patchJobMock.mockResolvedValue({ data: { id: "job-1" } });

    const { updateJobName } = await import("./action");
    await updateJobName({
      jobId: "job-1",
      data: { name: "" },
    });

    expect(patchJobMock).toHaveBeenCalledWith("job-1", {
      name: null,
    });
  });

  it("returns bad input when validation fails", async () => {
    const { updateJobName } = await import("./action");
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

      const { updateJobName } = await import("./action");
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

    const { updateJobName } = await import("./action");
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

    const { updateJobName } = await import("./action");
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

    const { requestRefundJob } = await import("./action");
    const result = await requestRefundJob({
      jobId: "job-1",
    });

    expect(requestJobRefundMock).toHaveBeenCalledWith("job-1");
    expect(result).toEqual({
      ok: true,
      value: {
        job: {
          id: "job-1",
          jobType: "PAID",
          status: "refund_pending",
        },
      },
    });
  });

  it("returns unauthorized when core rejects with 401 or 403", async () => {
    const { requestRefundJob } = await import("./action");

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

    const { requestRefundJob } = await import("./action");
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

    const { requestRefundJob } = await import("./action");
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

    const { requestRefundJob } = await import("./action");
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

    const { provideJobInput } = await import("./action");
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
    expect(result).toEqual({ ok: true, value: { jobId: "job-1" } });
  });

  it("returns BAD_INPUT and skips core for input it cannot narrow", async () => {
    const { provideJobInput } = await import("./action");
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

    const { provideJobInput } = await import("./action");
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
