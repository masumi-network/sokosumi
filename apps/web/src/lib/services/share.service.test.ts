import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getSharedResourceByTokenMock } = vi.hoisted(() => ({
  getSharedResourceByTokenMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(
      message: string,
      options?: { details?: unknown; kind?: string; status?: number },
    ) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getSharedResourceByToken: (...args: unknown[]) =>
      getSharedResourceByTokenMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { shareService } from "./share.service";

describe("shareService.getPubliclySharedResource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the shared resource from Core", async () => {
    const sharedResource = {
      kind: "job",
      share: { allowSearchIndexing: true },
      job: { id: "job_1" },
    };
    getSharedResourceByTokenMock.mockResolvedValue(sharedResource);

    await expect(
      shareService.getPubliclySharedResource("public-token"),
    ).resolves.toBe(sharedResource);
    expect(getSharedResourceByTokenMock).toHaveBeenCalledWith("public-token");
  });

  it("returns null for a 404 from Core", async () => {
    getSharedResourceByTokenMock.mockRejectedValue(
      new CoreApiRequestError("not found", { status: 404 }),
    );

    await expect(
      shareService.getPubliclySharedResource("missing-token"),
    ).resolves.toBeNull();
  });

  it("rethrows non-404 Core errors", async () => {
    const error = new CoreApiRequestError("boom", { status: 500 });
    getSharedResourceByTokenMock.mockRejectedValue(error);

    await expect(
      shareService.getPubliclySharedResource("bad-token"),
    ).rejects.toBe(error);
  });
});
