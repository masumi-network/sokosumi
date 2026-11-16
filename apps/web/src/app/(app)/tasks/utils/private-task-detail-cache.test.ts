import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaskByIdMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
  },
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getPrivateCachedSession: async () => null,
}));

const { getPrivateCachedTask } = await import("./private-task-detail-cache");
const { CoreApiRequestError } = await import("@/lib/clients/core.request");

function coreError(status: number) {
  return new CoreApiRequestError(`Core answered ${status}`, { status });
}

describe("getPrivateCachedTask", () => {
  beforeEach(() => {
    getTaskByIdMock.mockReset();
  });

  it("reads a task Core does not have in this workspace as null", async () => {
    getTaskByIdMock.mockRejectedValue(coreError(404));

    await expect(getPrivateCachedTask("SOK-1")).resolves.toBeNull();
  });

  // A "use cache" entry keeps a returned value but never a thrown error. An
  // outage must throw, so no later read in the same request gets a cached
  // "not found" for a task that exists.
  it("throws on any other Core failure instead of caching it as missing", async () => {
    getTaskByIdMock.mockRejectedValue(coreError(503));

    await expect(getPrivateCachedTask("SOK-1")).rejects.toThrow(
      "Core answered 503",
    );
  });
});
