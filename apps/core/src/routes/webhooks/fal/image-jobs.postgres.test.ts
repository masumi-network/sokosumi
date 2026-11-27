import crypto, { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { convertCreditsToCents } from "@sokosumi/utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * fal's completion callback against a real PostgreSQL database: the signed
 * delivery in, the job's rows out. A failed job takes nothing, a finished one
 * is charged its quote once, and the charge is a Mainnet one on either layout,
 * because the handler names Mainnet (Image Studio is Mainnet only).
 *
 * The expected rows were recorded from `origin/main` at `170ba780a`, before
 * the handler named the Network, by running this file against that tree.
 *
 * Only fal's key endpoint, the media download and Blob are stubbed.
 */

const { downloadMediaMock, putMock } = vi.hoisted(() => ({
  downloadMediaMock: vi.fn(),
  putMock: vi.fn(),
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
    }),
    getBetterAuthPublicBaseUrl: () => null,
  };
});
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  downloadMedia: downloadMediaMock,
}));

import prisma from "@/lib/db/prisma";
import { resetJwksCacheForTests } from "@/lib/image-studio/fal-webhook";
import falImageJobs from "@/routes/webhooks/fal/image-jobs";
import { expectCoreLog } from "@/test/core-log";
import { pngBytes } from "@/test/image-bytes";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const QUOTE = convertCreditsToCents(8);
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

/**
 * A client on one Network's schema, for the fixture's credits and the reads.
 * On the split layout the `Transaction` history trigger reads shared tables
 * by bare name, so the fixture's own inserts get the search path it needs.
 */
function networkClient(schema: string) {
  const clientUrl = new URL(url ?? "");
  if (onSplitLayout) {
    clientUrl.searchParams.set(
      "options",
      `-c search_path=${schema},${testSchemaNames().DATABASE_SCHEMA_SHARED}`,
    );
  }
  return createPrismaClient(clientUrl.href, { schema });
}
const mainnet = enabled
  ? networkClient(testSchemaNames().DATABASE_SCHEMA_MAINNET)
  : null;
const preprod =
  enabled && onSplitLayout
    ? networkClient(testSchemaNames().DATABASE_SCHEMA_PREPROD)
    : null;

let userId: string;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  if (!enabled || !mainnet) return;
  userId = randomUUID();
  workspaceId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "fal callback fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id: workspaceId } },
    },
  });
  projectId = (
    await prisma.project.create({
      data: { workspaceId, name: "fal callback fixture" },
    })
  ).id;
  const grant = await mainnet.transaction.create({
    data: { userId, amount: convertCreditsToCents(100) },
  });
  await mainnet.creditBucket.create({
    data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
  });
}, 30_000);

afterAll(async () => {
  if (!enabled || !mainnet) return;
  await prisma.projectImageAsset.deleteMany({ where: { projectId } });
  await prisma.projectImageJob.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await mainnet.creditConsumption.deleteMany({
    where: { transaction: { userId } },
  });
  await mainnet.creditBucket.deleteMany({ where: { userId } });
  await mainnet.transaction.deleteMany({ where: { userId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await mainnet.$disconnect();
  await preprod?.$disconnect();
}, 30_000);

beforeEach(() => {
  resetJwksCacheForTests();
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== JWKS_URL) return realFetch(input, init);
    const { x } = publicKey.export({ format: "jwk" });
    return Response.json({ keys: [{ kty: "OKP", crv: "Ed25519", x }] });
  });
  downloadMediaMock.mockResolvedValue({
    bytes: pngBytes(1024, 1024),
    contentType: "image/png",
  });
  putMock.mockResolvedValue({ pathname: `projects/${projectId}/x` });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeJob() {
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
      idempotencyKey: randomUUID(),
      status: "QUEUED",
      falRequestId: `fal-${randomUUID()}`,
      submitAttempts: 1,
      submittedAt: new Date(),
      chargedCents: QUOTE,
    },
  });
}

/** A delivery as fal signs it: request id, user id, time, body hash. */
async function deliver(body: unknown, sign = true) {
  const raw = JSON.stringify(body);
  const requestId = (body as { request_id: string }).request_id;
  const falUserId = "fal-user";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const message = [requestId, falUserId, timestamp, hash].join("\n");
  const signature = sign
    ? crypto.sign(null, Buffer.from(message), privateKey).toString("hex")
    : "00".repeat(64);
  return await falImageJobs.request("/fal/image-jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fal-webhook-request-id": requestId,
      "x-fal-webhook-user-id": falUserId,
      "x-fal-webhook-timestamp": timestamp,
      "x-fal-webhook-signature": signature,
    },
    body: raw,
  });
}

/** The job's rows that money and the answer depend on, ids replaced by roles. */
async function rows(jobId: string) {
  const job = await prisma.projectImageJob.findUniqueOrThrow({
    where: { id: jobId },
  });
  const assets = await prisma.projectImageAsset.findMany({
    where: { jobId },
    select: { version: true, contentType: true, width: true, height: true },
  });
  const spends = await mainnet!.transaction.findMany({
    where: { userId, amount: { lt: 0n } },
    select: {
      id: true,
      amount: true,
      userId: true,
      organizationId: true,
      creditConsumptions: { select: { amount: true } },
    },
  });
  return {
    job: {
      status: job.status,
      failureReason: job.failureReason,
      error: job.error,
      chargedCents: job.chargedCents,
      charged: spends.some((spend) => spend.id === job.transactionId),
      settled: job.settledAt !== null,
    },
    assets,
    spends: spends.map(({ id: _id, userId: owner, ...spend }) => ({
      ...spend,
      user: owner === userId ? "requester" : owner,
    })),
  };
}

describe.skipIf(!enabled)("fal's callback on PostgreSQL", () => {
  afterEach(async () => {
    // Each test reads the requester's spends from none.
    await mainnet!.creditConsumption.deleteMany({
      where: { transaction: { userId, amount: { lt: 0n } } },
    });
    await mainnet!.transaction.deleteMany({
      where: { userId, amount: { lt: 0n } },
    });
  });

  it("takes nothing for a job fal reports as failed", async () => {
    expectCoreLog("warn", "The image provider failed a generation");
    const job = await makeJob();

    const response = await deliver({
      request_id: job.falRequestId,
      status: "ERROR",
      error: "Unexpected status code: 422",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await rows(job.id)).toEqual({
      job: {
        status: "FAILED",
        failureReason: "provider_error",
        error: "The image provider could not finish this image.",
        chargedCents: QUOTE,
        charged: false,
        settled: true,
      },
      assets: [],
      spends: [],
    });
  });

  it("charges a finished job its quote once, on Mainnet", async () => {
    const job = await makeJob();
    const body = {
      request_id: job.falRequestId,
      status: "OK",
      payload: {
        images: [
          {
            url: "https://v3b.fal.media/files/a.png",
            width: 1024,
            height: 1024,
          },
        ],
      },
    };

    const response = await deliver(body);
    // fal retries a delivery; the second one changes nothing.
    const retry = await deliver(body);

    expect([response.status, retry.status]).toEqual([200, 200]);
    expect(await response.json()).toEqual({ ok: true });
    expect(await rows(job.id)).toEqual({
      job: {
        status: "SUCCEEDED",
        failureReason: null,
        error: null,
        chargedCents: QUOTE,
        charged: true,
        settled: true,
      },
      assets: [
        { version: 1, contentType: "image/png", width: 1024, height: 1024 },
      ],
      spends: [
        {
          amount: -QUOTE,
          user: "requester",
          organizationId: null,
          creditConsumptions: [{ amount: QUOTE }],
        },
      ],
    });
  });

  it.runIf(onSplitLayout)("never charges in Preprod", async () => {
    const job = await makeJob();

    await deliver({
      request_id: job.falRequestId,
      status: "OK",
      payload: { images: [{ url: "https://v3b.fal.media/files/a.png" }] },
    });

    expect((await rows(job.id)).job.charged).toBe(true);
    expect(await preprod!.transaction.count({ where: { userId } })).toBe(0);
    expect(
      await preprod!.creditConsumption.count({
        where: { transaction: { userId } },
      }),
    ).toBe(0);
  });

  it("answers an unsigned delivery 401 and changes nothing", async () => {
    expectCoreLog("warn", "Rejected a fal webhook delivery");
    const job = await makeJob();

    const response = await deliver(
      {
        request_id: job.falRequestId,
        status: "OK",
        payload: { images: [{ url: "https://v3b.fal.media/files/a.png" }] },
      },
      false,
    );

    expect(response.status).toBe(401);
    expect(await rows(job.id)).toEqual({
      job: {
        status: "QUEUED",
        failureReason: null,
        error: null,
        chargedCents: QUOTE,
        charged: false,
        settled: false,
      },
      assets: [],
      spends: [],
    });
  });
});
