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
      unreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
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
      unreachableSince: new Date(Date.now() - 7 * 60 * 60 * 1000),
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
