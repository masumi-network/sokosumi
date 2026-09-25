import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * The five findings, against a real PostgreSQL database and the actual service.
 *
 * Only the provider and Blob are mocked — every query, transaction, lease and
 * status transition below is executed by PostgreSQL.
 */

const {
  fetchQueueStatusMock,
  fetchQueueResultMock,
  downloadImageMock,
  putMock,
  accessMock,
} = vi.hoisted(() => ({
  fetchQueueStatusMock: vi.fn(),
  fetchQueueResultMock: vi.fn(),
  downloadImageMock: vi.fn(),
  putMock: vi.fn(),
  accessMock: vi.fn(),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    // Keep the real environment — the Prisma pool is built from
    // `getEnv().DATABASE_URL` — and add only what the studio needs.
    getEnv: () => ({
      ...actual.getEnv(),
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "t",
    }),
    getBetterAuthPublicBaseUrl: () => null,
  };
});
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: accessMock,
  requireProjectAccessForUser: accessMock,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  fetchQueueStatus: fetchQueueStatusMock,
  fetchQueueResult: fetchQueueResultMock,
  downloadImage: downloadImageMock,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import {
  reconcileJob,
  reconcileProjectJobs,
  reconcileStaleJobs,
  settleWithImage,
} from "@/services/image-studio-jobs.service";

let userId: string;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  if (!enabled) return;
  userId = randomUUID();
  workspaceId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Image studio recovery fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id: workspaceId } },
    },
  });
  const project = await prisma.project.create({
    data: { workspaceId, name: "Image studio recovery fixture" },
  });
  projectId = project.id;
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.projectImageAsset.deleteMany({ where: { projectId } });
  await prisma.projectImageJob.deleteMany({ where: { projectId } });
});

async function makeJob(overrides: Record<string, unknown> = {}) {
  return await prisma.projectImageJob.create({
    data: {
      projectId,
      workspaceId,
      requestedByUserId: userId,
      kind: "GENERATE",
      model: "fal-ai/gemini-3.1-flash-image-preview",
      prompt: "a cup",
      settings: {},
      referenceAssetIds: [],
      idempotencyKey: `k-${Math.random()}`,
      status: "QUEUED",
      falRequestId: `fal-${Math.random()}`,
      submitAttempts: 1,
      submittedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accessMock.mockResolvedValue({ projectId, workspaceId, userId });
  downloadImageMock.mockResolvedValue({
    bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    contentType: "image/png",
  });
  putMock.mockResolvedValue({ pathname: `projects/${projectId}/x` });
  fetchQueueResultMock.mockResolvedValue({
    kind: "images",
    images: [{ url: "https://v3b.fal.media/files/a.png" }],
  });
});

describe.skipIf(!enabled)("finding 1 — uncertain jobs stay recoverable", () => {
  it("survives many rapid outages, then succeeds when the provider returns", async () => {
    const job = await makeJob();
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "503",
    });
    for (let n = 0; n < 40; n++) await reconcileJob(job.id);

    let row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // Forty failures inside a minute is not a six-hour outage.
    expect(row.status).toBe("QUEUED");

    fetchQueueStatusMock.mockResolvedValue({ kind: "completed" });
    await reconcileJob(job.id);

    row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("SUCCEEDED");
    expect(downloadImageMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a job already written off as uncertain", async () => {
    const job = await makeJob({
      status: "SUBMISSION_UNCERTAIN",
      settledAt: new Date(),
      statusUnreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });

    // The completion callback the webhook drives.
    await settleWithImage(job.id, "https://v3b.fal.media/files/a.png");

    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { asset: true },
    });
    // Previously ignored forever: zero polls, zero downloads, zero assets.
    expect(row.status).toBe("SUCCEEDED");
    expect(row.asset).not.toBeNull();
  });

  it("gives up only after the outage itself has run for six hours", async () => {
    const job = await makeJob({
      statusUnreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
      pollFailures: 2,
    });
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "503",
    });

    await reconcileJob(job.id);

    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("SUBMISSION_UNCERTAIN");
    // Still recoverable, and still honest that it may have been charged.
    expect(row.error).toContain("provider could not be reached");
  });
});

describe.skipIf(!enabled)(
  "finding 2 — the settlement lease is owner-fenced",
  () => {
    it("is not released by an unrelated failed poll mid-settlement", async () => {
      const job = await makeJob();
      let releaseUpload: (() => void) | undefined;
      putMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseUpload = () =>
              resolve({ pathname: `projects/${projectId}/x` });
          }),
      );

      // One settler, held inside the upload.
      const settling = settleWithImage(job.id, "https://v3b.fal.media/a.png");
      await vi.waitFor(() => expect(putMock).toHaveBeenCalled());

      const held = await prisma.projectImageJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(held.settleLeaseAt).not.toBeNull();

      // Meanwhile a status read fails. It owns no lease.
      fetchQueueStatusMock.mockResolvedValue({
        kind: "unreachable",
        message: "503",
      });
      await reconcileJob(job.id);

      const during = await prisma.projectImageJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      // Used to be null here, which let a second worker download and store the
      // same image concurrently.
      expect(during.settleLeaseAt).not.toBeNull();
      expect(during.settleLeaseOwner).toBe(held.settleLeaseOwner);

      // A second settler is refused while the first still holds it.
      await settleWithImage(job.id, "https://v3b.fal.media/a.png");
      expect(downloadImageMock).toHaveBeenCalledTimes(1);

      releaseUpload?.();
      await settling;
    });

    it("lets a later settler through once the lease has expired", async () => {
      const job = await makeJob({
        settleLeaseAt: new Date(Date.now() - 10 * 60 * 1000),
        settleLeaseOwner: "dead-worker",
      });

      await settleWithImage(job.id, "https://v3b.fal.media/a.png");

      const row = await prisma.projectImageJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      // Crash recovery still works.
      expect(row.status).toBe("SUCCEEDED");
    });
  },
);

describe.skipIf(!enabled)("outage clocks are per dependency", () => {
  it("a healthy status read does not reset a continuing result outage", async () => {
    // Reproduced by an independent review as RESULT_OUTAGE_RESET: every
    // successful status read cleared the single shared clock, so a continuing
    // result failure could be reconciled forever without its elapsed time ever
    // reaching the grace period.
    const startedAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
    const job = await makeJob({ resultUnreachableSince: startedAt });
    fetchQueueStatusMock.mockResolvedValue({ kind: "completed" });
    fetchQueueResultMock.mockResolvedValue({
      kind: "unreachable",
      message: "result fetch failed",
    });

    await reconcileJob(job.id);

    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // The status read succeeded, so only its own clock is clear.
    expect(row.statusUnreachableSince).toBeNull();
    // The result outage keeps the seven hours it has actually been failing,
    // and so reaches the grace period.
    expect(row.status).toBe("SUBMISSION_UNCERTAIN");
    expect(row.error).toContain("could not fetch");
  });

  it("a healthy status read does not reset a continuing authorization outage", async () => {
    // AUTH_OUTAGE_RESET in the same review.
    const startedAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
    const job = await makeJob({ authUnreachableSince: startedAt });
    fetchQueueStatusMock.mockResolvedValue({ kind: "in_queue" });

    await reconcileJob(job.id);

    let row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.authUnreachableSince?.getTime()).toBe(startedAt.getTime());

    // Now the ownership lookup fails again, on its own long-running outage.
    accessMock.mockRejectedValue(new Error("P1001 cannot reach database"));
    await settleWithImage(job.id, "https://v3b.fal.media/a.png");

    row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("SUBMISSION_UNCERTAIN");
    expect(row.error).toContain("belongs to");
  });

  it("a newly failing dependency does not inherit another's elapsed time", async () => {
    // SOURCE_SWITCH: a seven-hour authorization outage followed by the *first*
    // failed provider read was announced as a seven-hour provider outage.
    const job = await makeJob({
      authUnreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });
    fetchQueueStatusMock.mockResolvedValue({
      kind: "unreachable",
      message: "first provider failure",
    });

    await reconcileJob(job.id);

    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // Still live: the provider has been unreachable for seconds, not hours.
    expect(row.status).toBe("QUEUED");
    expect(row.statusUnreachableSince).not.toBeNull();
    expect(row.authUnreachableSince).not.toBeNull();
  });
});

describe.skipIf(!enabled)("bounded recovery sweeps make progress", () => {
  // These assert what a *bounded* batch reaches, so the project must hold only
  // the rows under test — a leftover live job would fill a slot on its own
  // merits and prove nothing either way.
  beforeEach(async () => {
    if (!enabled) return;
    await prisma.projectImageAsset.deleteMany({ where: { projectId } });
    await prisma.projectImageJob.deleteMany({ where: { projectId } });
  });

  it("are not starved by uncertain rows with no provider request id", async () => {
    // PROJECT_STARVATION / CRON_STARVATION: rows with no request id can never
    // be advanced by a provider read, but they sorted first and consumed the
    // whole batch, so the job that could have progressed was never reached.
    const older = new Date(Date.now() - 9 * 60 * 60 * 1000);
    for (let n = 0; n < 3; n++) {
      await prisma.projectImageJob.create({
        data: {
          projectId,
          workspaceId,
          requestedByUserId: userId,
          kind: "GENERATE",
          model: "fal-ai/gemini-3.1-flash-image-preview",
          prompt: "stranded",
          settings: {},
          referenceAssetIds: [],
          idempotencyKey: `no-id-${n}-${Math.random()}`,
          status: "SUBMISSION_UNCERTAIN",
          falRequestId: null,
          submitAttempts: 1,
          createdAt: older,
          updatedAt: older,
        },
      });
    }
    const recoverable = await makeJob();
    fetchQueueStatusMock.mockResolvedValue({ kind: "completed" });

    await reconcileProjectJobs(projectId);

    expect(fetchQueueStatusMock).toHaveBeenCalled();
    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: recoverable.id },
    });
    expect(row.status).toBe("SUCCEEDED");

    // The stranded rows are still there, still fenced against resubmission.
    const stranded = await prisma.projectImageJob.findMany({
      where: { projectId, falRequestId: null },
    });
    expect(stranded).toHaveLength(3);
    for (const job of stranded) expect(job.submitAttempts).toBe(1);
  });

  it("reaches a recoverable job through the cron sweep too", async () => {
    const old = new Date(Date.now() - 9 * 60 * 60 * 1000);
    const recoverable = await makeJob();
    await prisma.projectImageJob.update({
      where: { id: recoverable.id },
      data: { updatedAt: old },
    });
    fetchQueueStatusMock.mockResolvedValue({ kind: "completed" });

    await reconcileStaleJobs({ olderThanMs: 60_000, limit: 3 });

    const row = await prisma.projectImageJob.findUniqueOrThrow({
      where: { id: recoverable.id },
    });
    expect(row.status).toBe("SUCCEEDED");
  });
});
