import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressions for the recovery defects an independent review reproduced.
 *
 * Each test here failed before the corresponding fix. They are about money and
 * access, not shape: a paid request must not be abandoned because a socket
 * hiccuped, a reservation must not strand a project's concurrency for ever,
 * and an image must not be published to somebody who has lost access.
 */

const {
  jobFindUniqueMock,
  jobFindManyMock,
  jobUpdateMock,
  jobUpdateManyMock,
  jobCountMock,
  jobCreateMock,
  jobFindUniqueOrThrowMock,
  assetFindUniqueMock,
  fetchQueueStatusMock,
  fetchQueueResultMock,
  cancelQueuedMock,
  downloadImageMock,
  submitToQueueMock,
  requireProjectAccessMock,
  requireProjectAccessForUserMock,
  getEnvMock,
  putMock,
} = vi.hoisted(() => ({
  jobFindUniqueMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  jobCountMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  assetFindUniqueMock: vi.fn(),
  fetchQueueStatusMock: vi.fn(),
  fetchQueueResultMock: vi.fn(),
  cancelQueuedMock: vi.fn(),
  downloadImageMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  requireProjectAccessForUserMock: vi.fn(),
  getEnvMock: vi.fn(),
  putMock: vi.fn(),
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
      findUniqueOrThrow: jobFindUniqueOrThrowMock,
      findMany: jobFindManyMock,
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
      count: jobCountMock,
      create: jobCreateMock,
    },
    projectImageAsset: {
      findUnique: assetFindUniqueMock,
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
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
  requireProjectAccess: requireProjectAccessMock,
  requireProjectAccessForUser: requireProjectAccessForUserMock,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  fetchQueueStatus: fetchQueueStatusMock,
  fetchQueueResult: fetchQueueResultMock,
  cancelQueued: cancelQueuedMock,
  downloadImage: downloadImageMock,
  submitToQueue: submitToQueueMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import { IMAGE_MODEL_GENERATE } from "@/lib/image-studio/fal-client";
import {
  reconcileJob,
  recoverUnclaimedReservations,
  requestCancel,
  settleWithImage,
} from "@/services/image-studio-jobs.service";

function queuedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    requestedByUserId: "user-1",
    model: IMAGE_MODEL_GENERATE,
    kind: "GENERATE",
    prompt: "a cup",
    settings: {},
    parentAssetId: null,
    referenceAssetIds: [],
    status: "QUEUED",
    falRequestId: "fal-1",
    submitAttempts: 1,
    pollFailures: 0,
    cancelRequestedAt: null,
    createdAt: new Date(),
    asset: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({ FAL_KEY: "k", BLOB_READ_WRITE_TOKEN: "t" });
  jobUpdateManyMock.mockResolvedValue({ count: 1 });
  // `noteUnreachable` reads these back to decide whether the grace period has
  // run out, so the default stands for "sent a moment ago".
  jobUpdateMock.mockResolvedValue({ unreachableSince: new Date() });
  requireProjectAccessForUserMock.mockResolvedValue({
    projectId: "project-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
});

describe("a reconcile that never reached the provider", () => {
  it("does not settle the job", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "socket hang up",
    });

    await reconcileJob("job-1");

    // The whole point: a transport blip used to write FAILED, after which
    // every later reconcile and the provider's own callback skipped the job,
    // and the only way forward was buying the image again.
    const statuses = jobUpdateManyMock.mock.calls.map(
      (call) => call[0].data?.status,
    );
    expect(statuses).not.toContain("FAILED");
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pollFailures: { increment: 1 } }),
      }),
    );
  });

  it("still settles terminally when the provider itself answers", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    fetchQueueStatusMock.mockResolvedValue({ kind: "not_found" });

    await reconcileJob("job-1");

    expect(jobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});

describe("completion when the requester has lost access", () => {
  it("stores nothing and marks the job orphaned", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    // No download, no blob write, no version — the three things that used to
    // happen for a user who had been removed from the organization.
    expect(downloadImageMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ORPHANED" }),
      }),
    );
  });

  it("checks the requester, not merely that the project exists", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    requireProjectAccessForUserMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    downloadImageMock.mockRejectedValue(new Error("stop here"));

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    expect(requireProjectAccessForUserMock).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
    });
  });
});

describe("cancellation", () => {
  it("records a request without ending the job", async () => {
    requireProjectAccessMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    cancelQueuedMock.mockResolvedValue("accepted");

    const prisma = (await import("@/lib/db/prisma")).default as unknown as {
      projectImageJob: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.projectImageJob.findFirst = vi.fn().mockResolvedValue(queuedJob());

    const result = await requestCancel({
      jobId: "job-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    expect(result.accepted).toBe(true);
    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    // fal may accept a cancellation and finish anyway. Writing CANCELED here
    // discarded images that had already been paid for.
    expect(written.some((data) => data.status === "CANCELED")).toBe(false);
    expect(written.some((data) => data.cancelRequestedAt instanceof Date)).toBe(
      true,
    );
  });

  it("keeps an image that arrives after the cancellation request", async () => {
    jobFindUniqueMock.mockResolvedValue(
      queuedJob({ cancelRequestedAt: new Date() }),
    );
    fetchQueueStatusMock.mockResolvedValue({ kind: "completed" });
    fetchQueueResultMock.mockResolvedValue({
      kind: "images",
      images: [{ url: "https://v3b.fal.media/files/a.png" }],
    });
    requireProjectAccessForUserMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    downloadImageMock.mockRejectedValue(new Error("stop after the decision"));

    await reconcileJob("job-1");

    // Reaching the download at all is the assertion: the job was not treated
    // as over because somebody asked for it to stop.
    expect(downloadImageMock).toHaveBeenCalled();
  });
});

describe("a download that fails after the provider produced the image", () => {
  it("keeps the job recoverable rather than failing it", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    requireProjectAccessForUserMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    downloadImageMock.mockRejectedValue(new Error("connection reset"));
    jobUpdateMock.mockResolvedValue({ unreachableSince: new Date() });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    // The image exists and has been paid for. Marking the job FAILED here
    // offered the person a "free-looking" retry that buys a second one.
    const statuses = jobUpdateManyMock.mock.calls.map(
      (call) => call[0].data?.status,
    );
    expect(statuses).not.toContain("FAILED");
    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pollFailures: { increment: 1 } }),
      }),
    );
  });
});

describe("the unreachable grace period", () => {
  it("is measured in elapsed time, not attempts", async () => {
    // A count is not a duration. The browser polls every three seconds and
    // several readers can poll at once, so a twelve-attempt budget could be
    // spent inside a minute and discard a request already paid for.
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "socket hang up",
    });
    // Forty failures, but the outage only began a minute ago.
    jobUpdateMock.mockResolvedValue({
      unreachableSince: new Date(Date.now() - 60_000),
    });

    await reconcileJob("job-1");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    expect(written.some((data) => data.status === "FAILED")).toBe(false);
    expect(written.some((data) => data.status === "SUBMISSION_UNCERTAIN")).toBe(
      false,
    );
  });

  it("gives up only after hours, and says the request may have been charged", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "socket hang up",
    });
    // The outage itself has now run for seven hours.
    jobUpdateMock.mockResolvedValue({
      unreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });

    await reconcileJob("job-1");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    // Never FAILED: FAILED advertises a free retry, and this request was sent.
    expect(written.some((data) => data.status === "FAILED")).toBe(false);
    expect(written.some((data) => data.status === "SUBMISSION_UNCERTAIN")).toBe(
      true,
    );
  });
});

describe("an access check that cannot answer", () => {
  it("does not discard a completed image", async () => {
    jobFindUniqueMock.mockResolvedValue(queuedJob());
    // A dropped connection, not a refusal.
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("P1001: cannot reach database"), {
        code: "P1001",
      }),
    );
    jobUpdateMock.mockResolvedValue({ unreachableSince: new Date() });

    await settleWithImage("job-1", "https://v3b.fal.media/files/a.png");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    expect(written.some((data) => data.status === "ORPHANED")).toBe(false);
    expect(downloadImageMock).not.toHaveBeenCalled();
    // Left live so a later reconcile can finish it.
    expect(jobUpdateMock).toHaveBeenCalled();
  });
});

describe("a cancellation the provider has since forgotten", () => {
  it("settles as cancelled on the ordinary path, not as a failure", async () => {
    jobFindUniqueMock.mockResolvedValue(
      queuedJob({ cancelRequestedAt: new Date() }),
    );
    fetchQueueStatusMock.mockResolvedValue({ kind: "not_found" });

    await reconcileJob("job-1");

    const written = jobUpdateManyMock.mock.calls.map((call) => call[0].data);
    expect(written.some((data) => data.status === "CANCELED")).toBe(true);
    expect(written.some((data) => data.status === "FAILED")).toBe(false);
  });
});

describe("a reservation whose process died before it claimed submission", () => {
  it("is finished rather than left holding the project's concurrency", async () => {
    const created = new Date(Date.now() - 120_000);
    jobFindManyMock.mockResolvedValue([
      {
        id: "job-9",
        createdAt: created,
        projectId: "project-1",
        requestedByUserId: "user-1",
      },
    ]);
    requireProjectAccessForUserMock.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    jobUpdateManyMock.mockResolvedValue({ count: 1 });
    jobFindUniqueOrThrowMock.mockResolvedValue(
      queuedJob({ id: "job-9", status: "SUBMITTING", falRequestId: null }),
    );
    submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-9" });
    jobUpdateMock.mockResolvedValue({});

    const result = await recoverUnclaimedReservations();

    // `submitAttempts: 0` is the proof it never reached fal, so sending it now
    // cannot be a second charge.
    expect(jobFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          submitAttempts: 0,
        }),
      }),
    );
    expect(result.submitted).toBe(1);
  });

  it("does not send one whose requester has lost access", async () => {
    // Recovery buys an image, so it needs the permission the original request
    // needed — and it runs minutes later with no request context.
    jobFindManyMock.mockResolvedValue([
      {
        id: "job-11",
        createdAt: new Date(Date.now() - 120_000),
        projectId: "project-1",
        requestedByUserId: "removed-user",
      },
    ]);
    requireProjectAccessForUserMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    jobUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await recoverUnclaimedReservations();

    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(result.denied).toBe(1);
    expect(jobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ORPHANED" }),
      }),
    );
  });

  it("leaves one alone when the access check itself is unavailable", async () => {
    jobFindManyMock.mockResolvedValue([
      {
        id: "job-12",
        createdAt: new Date(Date.now() - 120_000),
        projectId: "project-1",
        requestedByUserId: "user-1",
      },
    ]);
    requireProjectAccessForUserMock.mockRejectedValue(
      new Error("connection pool timeout"),
    );

    const result = await recoverUnclaimedReservations();

    // Neither sent nor discarded: not being able to ask is not a refusal.
    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(result.denied).toBe(0);
    expect(result.abandoned).toBe(0);
  });

  it("only looks at the project it was asked about", async () => {
    jobFindManyMock.mockResolvedValue([]);
    await recoverUnclaimedReservations({ projectId: "project-1" });
    expect(jobFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "project-1" }),
      }),
    );
  });

  it("releases one nobody is waiting for any more", async () => {
    const ancient = new Date(Date.now() - 60 * 60_000);
    jobFindManyMock.mockResolvedValue([
      {
        id: "job-10",
        createdAt: ancient,
        projectId: "project-1",
        requestedByUserId: "user-1",
      },
    ]);
    jobUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await recoverUnclaimedReservations();

    expect(result.abandoned).toBe(1);
    expect(submitToQueueMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});
