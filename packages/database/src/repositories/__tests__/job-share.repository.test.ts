import { beforeEach, describe, expect, it, vi } from "vitest";

import { jobShareRepository } from "../job-share.repository.js";

const upsertMock = vi.fn();

describe("jobShareRepository.upsertPublicShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({
      id: "share_123",
      jobId: "job_123",
      token: "public-share-token",
      allowSearchIndexing: true,
    });
  });

  it("creates a token once and preserves it on later updates", async () => {
    await jobShareRepository.upsertPublicShare("job_123", false, {
      jobShare: {
        upsert: upsertMock,
      },
    } as never);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job_123" },
        create: expect.objectContaining({
          allowSearchIndexing: false,
          token: expect.any(String),
        }),
        update: {
          allowSearchIndexing: false,
        },
      }),
    );
  });
});
