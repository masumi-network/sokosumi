import { beforeEach, describe, expect, it, vi } from "vitest";

const getJobByIdMock = vi.fn();
const mapCoreJobToJobWithSokosumiStatusMock = vi.fn();

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
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
}));

vi.mock("@/lib/agents/core-dto-mappers", () => ({
  mapCoreJobToJobWithSokosumiStatus: (...args: unknown[]) =>
    mapCoreJobToJobWithSokosumiStatusMock(...args),
}));

// Pass-through session middleware: the action body runs with an injected
// session, mirroring the production `withSession` behaviour.
vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      await handler({
        ...params,
        session: { user: { id: "user-1" } },
      } as TParams),
}));

describe("getJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the mapped job with bigint and Date fields intact", async () => {
    const mappedJob = {
      id: "job-1",
      cents: BigInt(4200),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      events: [{ size: BigInt(10) }],
    };
    getJobByIdMock.mockResolvedValue({ data: { id: "job-1" } });
    mapCoreJobToJobWithSokosumiStatusMock.mockReturnValue(mappedJob);

    const { getJob } = await import("../get-job.action");
    const result = await getJob({ jobId: "job-1" });

    expect(getJobByIdMock).toHaveBeenCalledWith("job-1");
    expect(result).toBe(mappedJob);
    // Round-trip sanity: non-JSON-primitive fields the route used superjson for.
    expect(typeof result.cents).toBe("bigint");
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("throws UnAuthenticatedError when core responds 401", async () => {
    getJobByIdMock.mockRejectedValue(
      new MockCoreApiRequestError("unauthorized", { status: 401 }),
    );

    const { getJob } = await import("../get-job.action");
    const { UnAuthenticatedError } = await import("@/lib/auth/errors");

    await expect(getJob({ jobId: "job-1" })).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
  });

  it("throws a not-found error when core responds 403", async () => {
    getJobByIdMock.mockRejectedValue(
      new MockCoreApiRequestError("forbidden", { status: 403 }),
    );

    const { getJob } = await import("../get-job.action");

    await expect(getJob({ jobId: "job-1" })).rejects.toThrow("Job not found");
  });

  it("throws a not-found error when core responds 404", async () => {
    getJobByIdMock.mockRejectedValue(
      new MockCoreApiRequestError("not found", { status: 404 }),
    );

    const { getJob } = await import("../get-job.action");

    await expect(getJob({ jobId: "job-1" })).rejects.toThrow("Job not found");
  });

  it("rethrows unexpected errors unchanged", async () => {
    const failure = new Error("boom");
    getJobByIdMock.mockRejectedValue(failure);

    const { getJob } = await import("../get-job.action");

    await expect(getJob({ jobId: "job-1" })).rejects.toBe(failure);
  });
});
