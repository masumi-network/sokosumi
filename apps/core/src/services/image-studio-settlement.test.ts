import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settling a job exactly once.
 *
 * An independent review ran six settlers against one job on a real database:
 * one asset row was created, and six objects were written to storage. The row
 * was deduplicated, but only after every settler had already downloaded the
 * image and uploaded its own copy, leaving five with nothing referencing them.
 */

const {
  jobFindUniqueMock,
  jobUpdateMock,
  jobUpdateManyMock,
  assetFindUniqueMock,
  assetFindFirstMock,
  assetCreateMock,
  downloadImageMock,
  fetchQueueStatusMock,
  putMock,
  requireProjectAccessForUserMock,
  getEnvMock,
} = vi.hoisted(() => ({
  jobFindUniqueMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  assetCreateMock: vi.fn(),
  downloadImageMock: vi.fn(),
  fetchQueueStatusMock: vi.fn(),
  putMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

// `BLOB_READ_WRITE_TOKEN` is present on purpose. It is the shared *public*
// store, the studio must never reach for it, and leaving it set is what lets
// the fail-closed tests below prove the studio refuses rather than falls back.
vi.mock("@/services/image-studio-files.service", () => ({
  publishImageToFiles: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getBetterAuthPublicBaseUrl: () => "https://core.example.com",
}));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
      count: vi.fn(),
      create: vi.fn(),
    },
    projectImageAsset: {
      findUnique: assetFindUniqueMock,
      findFirst: assetFindFirstMock,
      findMany: vi.fn().mockResolvedValue([]),
      create: assetCreateMock,
    },
    project: { findUnique: vi.fn() },
    $transaction: (run: (tx: unknown) => unknown) => run(client),
  };
  return { default: client };
});
vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    await run((await import("@/lib/db/prisma")).default),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: vi.fn(),
  requireProjectAccessForUser: requireProjectAccessForUserMock,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  downloadImage: downloadImageMock,
  fetchQueueStatus: fetchQueueStatusMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import {
  reconcileJob,
  settleWithImage,
} from "@/services/image-studio-jobs.service";

const JOB = {
  id: "job-1",
  projectId: "project-1",
  workspaceId: "workspace-1",
  requestedByUserId: "user-1",
  model: "fal-ai/gemini-3.1-flash-image-preview",
  kind: "GENERATE",
  prompt: "a cup",
  settings: {},
  parentAssetId: null,
  referenceAssetIds: [],
  status: "QUEUED",
  falRequestId: "fal-1",
  cancelRequestedAt: null,
  createdAt: new Date(),
  asset: null,
};

const STUDIO_BLOB_TOKEN = "studio-private-store-token";

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    FAL_KEY: "k",
    BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
    IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: STUDIO_BLOB_TOKEN,
  });
  jobFindUniqueMock.mockResolvedValue(JOB);
  requireProjectAccessForUserMock.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  downloadImageMock.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
  });
  putMock.mockResolvedValue({ pathname: "projects/p/image-studio/job-1-abc" });
  assetFindUniqueMock.mockResolvedValue(null);
  assetFindFirstMock.mockResolvedValue(null);
  assetCreateMock.mockResolvedValue({ id: "asset-1" });
  jobUpdateMock.mockResolvedValue({
    pollFailures: 1,
    submittedAt: new Date(),
    createdAt: new Date(),
  });
});

describe("the settlement lease", () => {
  it("is not touched at all by an unrelated failed poll", async () => {
    // An independent review held one settler inside the Blob put, made another
    // reader's status request unreachable, and watched the active lease go
    // null — so a second worker downloaded and stored the same image. A poll
    // does not hold this lease, so it has no business writing to it.
    const touched: string[] = [];
    jobUpdateManyMock.mockImplementation(async (args: never) => {
      const data = (args as unknown as { data: Record<string, unknown> }).data;
      for (const key of ["settleLeaseAt", "settleLeaseOwner"]) {
        if (key in data) touched.push(key);
      }
      return { count: 1 };
    });
    jobUpdateMock.mockImplementation(async (args: never) => {
      const data = (args as unknown as { data: Record<string, unknown> }).data;
      for (const key of ["settleLeaseAt", "settleLeaseOwner"]) {
        if (key in data) touched.push(key);
      }
      return { statusUnreachableSince: new Date() };
    });
    jobFindUniqueMock.mockResolvedValue({ ...JOB, status: "QUEUED" });
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "socket hang up",
    });

    await reconcileJob("job-1");

    expect(touched).toEqual([]);
  });

  it("claims with an owner and releases only as that owner", async () => {
    const calls: Array<{
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }> = [];
    jobUpdateManyMock.mockImplementation(async (args: never) => {
      const typed = args as unknown as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      calls.push(typed);
      return { count: 1 };
    });
    downloadImageMock.mockRejectedValue(new Error("connection reset"));
    jobUpdateMock.mockResolvedValue({ statusUnreachableSince: null });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const claim = calls.find((call) => call.data.settleLeaseOwner != null);
    const release = calls.find(
      (call) => call.data.settleLeaseAt === null && call.where.settleLeaseOwner,
    );
    expect(claim).toBeDefined();
    // Handed back by the same owner that took it, so a concurrent failure
    // elsewhere cannot unlock a settlement that is still running.
    expect(release?.where.settleLeaseOwner).toBe(claim?.data.settleLeaseOwner);
  });
});

describe("model and placement provenance", () => {
  it("copies the saved job endpoint and placement settings to the immutable version", async () => {
    const settings = {
      aspectRatio: "2:3",
      resolution: "2K",
      outputFormat: "png",
      seed: 17,
      placementId: "pinterest-pin",
    };
    jobFindUniqueMock.mockResolvedValue({
      ...JOB,
      model: "fal-ai/flux-2-pro",
      settings,
    });
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");
    expect(assetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model: "fal-ai/flux-2-pro", settings }),
      }),
    );
  });
});

describe("the stored version's dimensions", () => {
  /** A real PNG header, so the byte-reading fallback has something to read. */
  function pngBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const data = new DataView(bytes.buffer);
    data.setUint32(16, width);
    data.setUint32(20, height);
    return bytes;
  }

  /** A minimal lossy WebP, which is what `recraft/v3` actually returns. */
  function webpBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    bytes.set([0x9d, 0x01, 0x2a], 23);
    const data = new DataView(bytes.buffer);
    data.setUint16(26, width, true);
    data.setUint16(28, height, true);
    return bytes;
  }

  it("takes the provider's figures when fal reports them", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    downloadImageMock.mockResolvedValue({
      bytes: pngBytes(1, 1),
      contentType: "image/png",
    });

    // 1344x768 is what nucleus-image really returned at 16:9. The provider knows
    // without anybody guessing, so it wins over the header.
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png", {
      width: 1344,
      height: 768,
    });

    expect(assetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ width: 1344, height: 768 }),
      }),
    );
  });

  it("reads the image's own header when fal reports nothing", async () => {
    // `fal-ai/recraft/v3/text-to-image` — one of the curated five — returns WebP
    // and no dimensions, and every such asset stored 0x0 until this read the bytes.
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    downloadImageMock.mockResolvedValue({
      bytes: webpBytes(1024, 1024),
      contentType: "image/webp",
    });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.webp", {
      width: null,
      height: null,
    });

    expect(assetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ width: 1024, height: 1024 }),
      }),
    );
  });

  it("reads the header when the call carries no provider size at all", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    downloadImageMock.mockResolvedValue({
      bytes: pngBytes(832, 1216),
      contentType: "image/png",
    });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(assetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ width: 832, height: 1216 }),
      }),
    );
  });

  it("stores zero, and keeps the image, when nothing can be read", async () => {
    // Not a failure: the client falls back to the rendered image's intrinsic size.
    // Throwing away an image we paid for because its header is exotic would be
    // much worse than a missing number.
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    downloadImageMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/avif",
    });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.avif");

    expect(assetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ width: 0, height: 0 }),
      }),
    );
  });
});

describe("concurrent settlement", () => {
  it("does the paid work once when many settlers race one job", async () => {
    // Only the first caller wins the lease; the rest are refused before they
    // reach the network.
    let claims = 0;
    jobUpdateManyMock.mockImplementation(async (args: { data: unknown }) => {
      const data = args.data as Record<string, unknown>;
      const isLeaseClaim =
        "settleLeaseOwner" in data && data.settleLeaseAt instanceof Date;
      if (!isLeaseClaim) return { count: 1 };
      claims += 1;
      return { count: claims === 1 ? 1 : 0 };
    });

    await Promise.all(
      Array.from({ length: 6 }, () =>
        settleWithImage("job-1", "https://v3b.fal.media/files/a.png"),
      ),
    );

    expect(downloadImageMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(assetCreateMock).toHaveBeenCalledTimes(1);
  });

  it("writes one object per job, so a loser cannot leave an orphan", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const options = putMock.mock.calls[0]![2];
    // A random suffix meant each settler wrote its own object and the losers'
    // copies were left behind unreferenced. This is an idempotency device, not
    // a secret — nothing about access control rests on the pathname.
    expect(options.addRandomSuffix).toBe(false);
    expect(options.allowOverwrite).toBe(true);
    expect(putMock.mock.calls[0]![0]).toContain("job-1");
  });
});

describe("where generated images are stored", () => {
  // Generated images are project artwork. Vercel fixes public-or-private per
  // store, and `BLOB_READ_WRITE_TOKEN` names the shared store the rest of the
  // platform writes to, which is created with `access: "public"` — everything
  // in it is retrievable by URL with no credential. Serving the bytes through
  // an authorizing route does not un-publish an object the store already
  // serves anonymously, and a hashed pathname is obscurity, not authorization.
  beforeEach(() => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("writes privately, into the studio's own store", async () => {
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const options = putMock.mock.calls[0]![2];
    expect(options.access).toBe("private");
    expect(options.token).toBe(STUDIO_BLOB_TOKEN);
  });

  it("never reaches for the shared public store's token", async () => {
    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(putMock.mock.calls[0]![2].token).not.toBe(
      "shared-public-store-token",
    );
  });

  it("refuses to write anywhere else when no private store is set", async () => {
    // The shared public token is still present in the environment here. The
    // studio must refuse anyway: an image nobody can see is recoverable, an
    // image published by accident is not.
    getEnvMock.mockReturnValue({
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
    });
    jobUpdateMock.mockResolvedValue({ resultUnreachableSince: null });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(putMock).not.toHaveBeenCalled();
  });

  it("keeps the paid job recoverable instead of failing it", async () => {
    // `failJob` here was a real loss: fal has already produced and charged for
    // the image, FAILED is outside LIVE_STATUSES, and the row would drop out
    // of recoverableSelection() — so putting the token back could never bring
    // the image back, while the UI offered a "Try again" that would buy a
    // second one.
    getEnvMock.mockReturnValue({
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
    });
    jobUpdateMock.mockResolvedValue({ resultUnreachableSince: null });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const statuses = jobUpdateManyMock.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data.status,
    );
    expect(statuses).not.toContain("FAILED");

    const noted = jobUpdateMock.mock.calls
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => "lastPollError" in data);
    expect(noted?.unreachableSource).toBe("storage");
  });

  it("hands the lease back when it refuses for want of a private store", async () => {
    getEnvMock.mockReturnValue({
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
    });
    const calls: Array<{
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }> = [];
    jobUpdateManyMock.mockImplementation(async (args: never) => {
      calls.push(
        args as unknown as {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        },
      );
      return { count: 1 };
    });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const claim = calls.find((call) => call.data.settleLeaseOwner != null);
    const release = calls.find(
      (call) => call.data.settleLeaseAt === null && call.where.settleLeaseOwner,
    );
    expect(release?.where.settleLeaseOwner).toBe(claim?.data.settleLeaseOwner);
  });
});

describe("a settlement whose storage write fails", () => {
  // The put was the one settlement step with no failure handling: it threw
  // past the lease it was holding, wrote nothing to the row, and left the
  // caller to log it. A store that refuses every write therefore showed in the
  // UI as "Generating", with no error and no end, until someone read the
  // server log.
  beforeEach(() => {
    putMock.mockRejectedValue(
      new Error(
        "Vercel Blob: Cannot use private access on a public store. The store must be configured with private access.",
      ),
    );
  });

  it("does not let the failure escape the settler", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    jobUpdateMock.mockResolvedValue({ resultUnreachableSince: null });

    await expect(
      settleWithImage("job-1", "https://v3b.fal.media/files/a.png"),
    ).resolves.toBeUndefined();
  });

  it("hands the lease back to the owner that took it", async () => {
    const calls: Array<{
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }> = [];
    jobUpdateManyMock.mockImplementation(async (args: never) => {
      calls.push(
        args as unknown as {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        },
      );
      return { count: 1 };
    });
    jobUpdateMock.mockResolvedValue({ resultUnreachableSince: null });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const claim = calls.find((call) => call.data.settleLeaseOwner != null);
    const release = calls.find(
      (call) => call.data.settleLeaseAt === null && call.where.settleLeaseOwner,
    );
    // Without this the row stayed locked for the whole lease window after
    // every attempt, so nothing else could pick the paid image back up.
    expect(release).toBeDefined();
    expect(release?.where.settleLeaseOwner).toBe(claim?.data.settleLeaseOwner);
  });

  it("records the failure against storage, not the provider", async () => {
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    jobUpdateMock.mockResolvedValue({ resultUnreachableSince: null });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const noted = jobUpdateMock.mock.calls
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => "lastPollError" in data);
    // The same treatment the download failure above already gets: the image is
    // paid for and still recoverable, so the job stays live — but the reason
    // is on the row, and the outage clock that eventually says so has started.
    //
    // "storage" rather than "result": the download succeeded here, so blaming
    // the provider for an image "we could not fetch" would point the reader at
    // the wrong system.
    expect(noted?.unreachableSource).toBe("storage");
    expect(String(noted?.lastPollError)).toContain("public store");
  });
});
