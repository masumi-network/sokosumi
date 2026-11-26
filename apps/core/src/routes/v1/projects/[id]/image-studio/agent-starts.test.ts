import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR 0077: an agent (API key, OAuth or MCP token) may start an Image Studio
 * generation. Credits are the only cap, and `idempotencyKey` makes a retry
 * safe. These run the real route and the real service; only the database,
 * the balance and fal are fakes.
 */

const {
  jobAggregateMock,
  jobCreateMock,
  jobFindUniqueMock,
  jobFindUniqueOrThrowMock,
  jobUpdateMock,
  getBalanceMock,
  submitToQueueMock,
  requireProjectAccessMock,
} = vi.hoisted(() => ({
  jobAggregateMock: vi.fn(),
  jobCreateMock: vi.fn(),
  jobFindUniqueMock: vi.fn(),
  jobFindUniqueOrThrowMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  getBalanceMock: vi.fn(),
  submitToQueueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
}));

vi.mock("@/config/env", async () => ({
  ...(await vi.importActual<typeof import("@/config/env")>("@/config/env")),
  getEnv: () => ({
    FAL_KEY: "k",
    IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
  }),
  getBetterAuthPublicBaseUrl: () => "http://localhost:3001",
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: getBalanceMock },
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    projectImageJob: {
      aggregate: jobAggregateMock,
      count: vi.fn(async () => 0),
      create: jobCreateMock,
      findUnique: jobFindUniqueMock,
      findUniqueOrThrow: jobFindUniqueOrThrowMock,
      findMany: vi.fn(async () => []),
      update: jobUpdateMock,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectImageAsset: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    project: { findUnique: vi.fn() },
    projectImagePromptSnapshot: { upsert: vi.fn() },
    projectAdEvent: { create: vi.fn() },
    $transaction: (run: (tx: unknown) => unknown) => run(client),
  };
  return { default: client };
});

vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const prisma = (await import("@/lib/db/prisma")).default;
    return await run(prisma);
  },
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireProjectAccessForUser: requireProjectAccessMock,
}));

vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  submitToQueue: submitToQueueMock,
}));

import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { imageModel, studioImageModelId } from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";

import mount from "./jobs-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST_JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = "agent-intent-0001";
const PRICE_CENTS = convertCreditsToCents(
  creditsPerImage(imageModel(studioImageModelId()), {
    aspectRatio: "1:1",
    resolution: "1K",
  }),
);

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIRST_JOB_ID,
    projectId: PROJECT_ID,
    workspaceId: "workspace-1",
    requestedByUserId: "user-1",
    idempotencyKey: KEY,
    model: "fal-ai/model",
    kind: "GENERATE",
    prompt: "A calm product shot",
    settings: {
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
    },
    referenceAssetIds: [],
    referenceFileIds: [],
    parentAssetId: null,
    status: "QUEUED",
    submitAttempts: 1,
    createdAt: new Date("2026-11-24T08:00:00.000Z"),
    submittedAt: new Date("2026-11-24T08:00:01.000Z"),
    settledAt: null,
    cancelRequestedAt: null,
    error: null,
    failureReason: null,
    chargedCents: PRICE_CENTS,
    transactionId: null,
    ...overrides,
  };
}

const AGENTS = [
  { name: "an API key", authenticationMethod: "api_key" },
  { name: "an MCP token", authenticationMethod: "oauth" },
] as const;

function createApp(authenticationMethod: "api_key" | "oauth") {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "agent-start");
    c.set("authContext", {
      actor: "user",
      authenticationMethod,
      userId: "user-1",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "workspace-1",
      userId: "user-1",
      organizationId: null,
    });
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}

function start(app: ReturnType<typeof createApp>) {
  return app.request(`/${PROJECT_ID}/image-studio/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "A calm product shot",
      idempotencyKey: KEY,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectAccessMock.mockResolvedValue({
    projectId: PROJECT_ID,
    workspaceId: "workspace-1",
    userId: "user-1",
    organizationId: null,
  });
  jobAggregateMock.mockResolvedValue({ _sum: { chargedCents: null } });
  getBalanceMock.mockResolvedValue(PRICE_CENTS * 10n);
  jobFindUniqueMock.mockResolvedValue(null);
  // The row the service writes is the row it reads back to send.
  let reserved = jobRow();
  jobCreateMock.mockImplementation(async ({ data }) => {
    reserved = jobRow({ ...data, id: FIRST_JOB_ID, status: "PENDING" });
    return reserved;
  });
  jobFindUniqueOrThrowMock.mockImplementation(async () => reserved);
  jobUpdateMock.mockImplementation(async ({ data }) => jobRow(data));
  submitToQueueMock.mockResolvedValue({ kind: "queued", requestId: "fal-1" });
});

describe.each(AGENTS)(
  "an agent start with $name",
  ({ authenticationMethod }) => {
    it("is refused when the balance cannot cover it, before fal is called", async () => {
      getBalanceMock.mockResolvedValue(PRICE_CENTS - 1n);

      const response = await start(createApp(authenticationMethod));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      });
      expect(jobCreateMock).not.toHaveBeenCalled();
      expect(submitToQueueMock).not.toHaveBeenCalled();
    });

    it("is refused when the jobs in flight already use the balance", async () => {
      getBalanceMock.mockResolvedValue(PRICE_CENTS * 2n);
      jobAggregateMock.mockResolvedValue({
        _sum: { chargedCents: PRICE_CENTS * 2n },
      });

      const response = await start(createApp(authenticationMethod));

      expect(response.status).toBe(422);
      expect(submitToQueueMock).not.toHaveBeenCalled();
    });

    it("returns the first job for a duplicate idempotencyKey, buying nothing twice", async () => {
      const app = createApp(authenticationMethod);
      const first = await start(app);
      expect(first.status).toBe(201);
      expect(submitToQueueMock).toHaveBeenCalledTimes(1);

      // The retry finds the row the first request reserved.
      jobFindUniqueMock.mockResolvedValue(jobRow());
      const retry = await start(app);

      expect(retry.status).toBe(201);
      expect(await retry.json()).toMatchObject({
        data: { id: FIRST_JOB_ID, status: "QUEUED" },
      });
      expect(jobCreateMock).toHaveBeenCalledTimes(1);
      expect(submitToQueueMock).toHaveBeenCalledTimes(1);
    });
  },
);
