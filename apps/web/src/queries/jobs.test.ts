import type { Session } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getJobQueryOptions } from "@/queries/jobs";

const getJobMock = vi.fn();

vi.mock("@/lib/actions/job", () => ({
  getJob: (...args: unknown[]) => getJobMock(...args),
}));

describe("getJobQueryOptions", () => {
  beforeEach(() => {
    getJobMock.mockReset();
  });

  it("calls the getJob server action with the job id", async () => {
    const job = { id: "job-1", credits: 42 };
    getJobMock.mockResolvedValue(job);

    const options = getJobQueryOptions("job-1", {
      user: { id: "user-1" },
    } as Session);

    const queryFn = options.queryFn;
    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).resolves.toBe(job);
    expect(getJobMock).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it("throws UnAuthenticatedError when there is no session", async () => {
    const options = getJobQueryOptions("job-1", null);

    const queryFn = options.queryFn;
    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
    expect(getJobMock).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by the getJob action", async () => {
    getJobMock.mockRejectedValue(new UnAuthenticatedError());

    const options = getJobQueryOptions("job-1", {
      user: { id: "user-1" },
    } as Session);

    const queryFn = options.queryFn;
    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).rejects.toBeInstanceOf(
      UnAuthenticatedError,
    );
  });
});
