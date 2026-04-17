import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { JobErrorCode } from "@/lib/actions/errors/error-codes/job";

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
      setTag: vi.fn(),
      setContext: vi.fn(),
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
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/lib/services", () => ({
  callAgentHiredWebHook: vi.fn(),
  jobService: {
    moveJobToWorkspace: vi.fn(),
    provideJobInput: vi.fn(),
    requestRefund: vi.fn(),
    startDemoJob: vi.fn(),
    startJob: vi.fn(),
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    getJobByBlockchainIdentifier: vi.fn(),
  },
  userRepository: {
    getUserById: vi.fn(),
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

  it.each([
    401, 403,
  ])("returns unauthorized when core rejects with %i", async (status) => {
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
  });

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
