/** Real Task authorization and PostgreSQL locking. Only external boundaries are local fixtures. */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { Hono } from "hono";
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
import { lockTaskRows } from "@/helpers/calendar-locks";
import { errorHandler } from "@/helpers/error-handler";
import { createTaskEventTransaction } from "@/helpers/task-credits";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import { revokeVendorGrantInWorkspace } from "@/helpers/vendor-grants";
import type { CreateBlobUploadGrantInput } from "@/lib/blob-upload-grant";
import prisma from "@/lib/db/prisma";
import { type EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import uploadRouter from "@/routes/v1/webhooks/tasks/files/uploaded";
import { focusedReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import mountEvents from "./[id]/events/post";
import mountFiles from "./[id]/files/post";

const { headMock, delMock, grantMock, fixtureEnv } = vi.hoisted(() => ({
  headMock: vi.fn(),
  delMock: vi.fn(),
  grantMock: vi.fn(),
  fixtureEnv: {
    publicKey: "",
    globalCoworkerId: null as string | null,
  },
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      ...(fixtureEnv.globalCoworkerId
        ? {
            SEO_ANALYSIS_EXECUTOR: {
              mode: "global",
              coworkerId: fixtureEnv.globalCoworkerId,
              canUsePaidSearchData: true,
              canSchedule: true,
            },
          }
        : {}),
      BLOB_READ_WRITE_TOKEN: "blob-worker-local-fixture",
      BLOB_WEBHOOK_PUBLIC_KEY: fixtureEnv.publicKey,
    }),
    getBetterAuthPublicBaseUrl: () => "https://core.example.test",
  };
});
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  head: headMock,
  del: delMock,
}));
vi.mock("@/lib/blob-upload-grant", () => ({
  createBlobUploadGrant: grantMock,
}));
vi.mock("@/lib/ably/publish", () => ({ publishTaskEventData: vi.fn() }));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverCalendarInvalidationsNow: vi.fn(),
}));
vi.mock("@/helpers/billing-notifications", () => ({
  notifyLowBalanceAfterCharge: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskParticipantsAdded: vi.fn(),
  notifyTaskStatusEvent: vi.fn(),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const keys = generateKeyPairSync("ed25519");
const CALLBACK_PATH = "/v1/webhooks/tasks/files/context-v1/uploaded";
const LEGACY_CALLBACK_PATH = "/v1/webhooks/tasks/files/uploaded";
const FILE_SIZE = 10_000;
const LOCK_WAIT_TIMEOUT_MS = 3_000;
const LOCK_POLL_MS = 20;
const ownerId = randomUUID(),
  otherOwnerId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  personalWorkspaceId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID(),
  siblingId = randomUUID();

describe.skipIf(!enabled)("Guarded worker Task writes", () => {
  let taskId: string;
  let app: Hono<EnvVariables>;
  let actor: AuthenticationContext;
  let grantInput: CreateBlobUploadGrantInput | undefined;

  const expectedContext = () => ({ ownerId, organizationId, workspaceId });
  const fileUrl = () =>
    `https://store.public.blob.vercel-storage.com/tasks/${taskId}/report-random.json`;

  async function event(body: Record<string, unknown>, guarded = true) {
    return app.request(
      `/v1/tasks/${taskId}/events${guarded ? "/context-v1" : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(guarded ? { expectedContext: expectedContext() } : {}),
          ...body,
        }),
      },
    );
  }

  async function mint(guarded = true) {
    const response = await app.request(
      `/v1/tasks/${taskId}/files${guarded ? "/context-v1" : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: `seo-report-${taskId}.json`,
          contentType: "application/json",
          size: FILE_SIZE,
          ...(guarded ? { expectedContext: expectedContext() } : {}),
        }),
      },
    );
    return response;
  }

  async function complete(
    options: { payload?: string; validSignature?: boolean; path?: string } = {},
  ) {
    const body = JSON.stringify({
      type: "blob.upload-completed",
      payload: {
        blob: {
          url: fileUrl(),
          pathname: `tasks/${taskId}/report-random.json`,
          contentType: "application/json",
          contentDisposition: "inline",
          downloadUrl: fileUrl(),
          etag: "worker-fixture",
        },
        tokenPayload:
          options.payload ?? grantInput?.onUploadCompleted?.tokenPayload,
      },
    });
    return app.request(options.path ?? CALLBACK_PATH, {
      method: "POST",
      headers: {
        "x-vercel-signature":
          options.validSignature === false
            ? "00".repeat(64)
            : sign(null, Buffer.from(body), keys.privateKey).toString("hex"),
      },
      body,
    });
  }

  async function expectNoWrites() {
    expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(0);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(0);
    expect(await prisma.taskParticipant.count({ where: { taskId } })).toBe(0);
    expect(
      await prisma.transaction.count({
        where: { organizationId, amount: { lt: 0n } },
      }),
    ).toBe(0);
  }

  async function waitForBlockedTaskWrite(holderPid: number) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [state] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%FROM "task"%'
            AND query LIKE '%FOR UPDATE%'
        ) AS waiting
      `;
      if (state.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    throw new Error("The worker did not wait for the held Task row lock");
  }

  async function waitForBlockedGrantWrite(holderPid: number) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [state] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%"vendor_grant"%'
        ) AS waiting
      `;
      if (state.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    throw new Error(
      "The concurrent write did not wait for the held Vendor grant",
    );
  }

  beforeAll(async () => {
    fixtureEnv.publicKey = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    await prisma.user.createMany({
      data: [ownerId, otherOwnerId].map((id) => ({
        id,
        name: "Guarded Task fixture",
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Guarded Task fixture",
        slug: organizationId,
        workspace: { create: { id: workspaceId } },
        members: {
          create: [ownerId, otherOwnerId].map((userId) => ({
            userId,
            role: "member",
            seatAssignedAt: new Date(),
          })),
        },
      },
    });
    await prisma.workspace.create({
      data: { id: personalWorkspaceId, userId: ownerId },
    });
    await prisma.vendor.create({
      data: {
        id: vendorId,
        name: "Guarded Task fixture",
        slug: vendorId,
        coworkers: {
          create: [coworkerId, siblingId].map((id) => ({
            id,
            name: "Guarded Task fixture",
            slug: id,
            capabilities: ["tasks"],
            isWhitelisted: true,
          })),
        },
      },
    });
    const topup = await prisma.transaction.create({
      data: { amount: convertCreditsToCents(10), organizationId },
    });
    await prisma.creditBucket.create({
      data: {
        amount: topup.amount,
        organizationId,
        sourceTransactionId: topup.id,
      },
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fixtureEnv.globalCoworkerId = null;
    grantInput = undefined;
    taskId = (
      await prisma.task.create({
        data: {
          ownerId,
          organizationId,
          workspaceId,
          assigneeId: coworkerId,
          name: "Guarded Task delivery",
          status: TaskStatus.RUNNING,
        },
      })
    ).id;
    actor = { actor: "coworker", coworkerId, vendorId };
    const tasks = new OpenAPIHonoWithAuth();
    tasks.use("*", async (c, next) => {
      c.set("authContext", actor);
      c.set("isAuthenticated", true);
      c.set("workspaceContext", null);
      await next();
    });
    mountEvents(tasks);
    mountFiles(tasks);
    app = new Hono<EnvVariables>();
    app.onError(errorHandler);
    app.route("/v1/tasks", tasks);
    app.route("/v1/webhooks/tasks/files", uploadRouter);
    headMock.mockResolvedValue({
      size: FILE_SIZE,
      contentType: "application/json",
    });
    delMock.mockResolvedValue(undefined);
    grantMock.mockImplementation(async (input: CreateBlobUploadGrantInput) => {
      grantInput = input;
      return {
        uploadUrl: "https://blob.example.test/upload",
        pathname: input.pathname,
        access: "public",
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxSizeBytes: input.maxSizeBytes,
        addRandomSuffix: true,
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected external network call");
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.task.deleteMany({ where: { id: taskId } });
    await prisma.vendorGrant.deleteMany({ where: { vendorId, workspaceId } });
    await prisma.transaction.deleteMany({
      where: { organizationId, amount: { lt: 0n } },
    });
  });

  afterAll(async () => {
    await prisma.seoAudit.deleteMany({ where: { workspaceId } });
    await prisma.transaction.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.workspace.deleteMany({ where: { id: personalWorkspaceId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherOwnerId] } },
    });
    await prisma.$disconnect();
  });

  async function markNativeTask(maxProviderCalls = 0) {
    const audit = await prisma.seoAudit.create({
      data: {
        workspaceId,
        name: "Native worker authorization",
        createdById: ownerId,
      },
    });
    const analysis = await prisma.projectSeoAnalysis.create({
      data: {
        auditId: audit.id,
        idempotencyKey: randomUUID(),
        requestHash: "native-worker-fixture",
        kind: "page_check",
        taskId,
        pageIds: [],
        requestedBy: ownerId,
        request: {
          version: 1,
          kind: "page_check",
          pageUrls: [SEO_TEST_PAGE],
          budget: { maxProviderCalls },
        },
      },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        description: `seo_job: ${JSON.stringify(analysis.request)}`,
      },
    });
    return analysis;
  }

  async function vendorGrant(status: "GRANTED" | "DENIED" | "REVOKED") {
    return prisma.vendorGrant.create({
      data: { vendorId, workspaceId, permission: "workspace", status },
    });
  }

  it.each(["DENIED", "REVOKED"] as const)(
    "rejects native SEO %s at start, billing and upload, including legacy routes",
    async (status) => {
      await markNativeTask();
      await vendorGrant(status);
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "READY" },
      });
      for (const guarded of [true, false]) {
        expect((await event({ status: "RUNNING" }, guarded)).status).toBe(403);
        expect(
          (await event({ comment: "Charge", credits: 1 }, guarded)).status,
        ).toBe(403);
        expect((await mint(guarded)).status).toBe(403);
      }
      await expectNoWrites();
      expect(grantMock).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "refuses a native SEO signed callback revoked after upload mint (guarded=%s)",
    async (guarded) => {
      await markNativeTask();
      const grant = await vendorGrant("GRANTED");
      expect((await mint(guarded)).status).toBe(201);
      await prisma.vendorGrant.update({
        where: { id: grant.id },
        data: { status: "REVOKED" },
      });
      expect(
        (
          await complete({
            path: guarded ? CALLBACK_PATH : LEGACY_CALLBACK_PATH,
          })
        ).status,
      ).toBe(200);
      await expectNoWrites();
      expect(fetch).not.toHaveBeenCalled();
      expect(delMock).not.toHaveBeenCalled();
    },
  );

  it("refuses native SEO paid start with HTTP 422 when its frozen payer cannot cover the ceiling", async () => {
    await markNativeTask(20);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "READY" },
    });
    // Personal money must not fund this Organization Task's 150-credit ceiling.
    const personalTopup = await prisma.transaction.create({
      data: { userId: ownerId, amount: convertCreditsToCents(200) },
    });
    const personalBucket = await prisma.creditBucket.create({
      data: {
        userId: ownerId,
        amount: personalTopup.amount,
        sourceTransactionId: personalTopup.id,
      },
    });
    try {
      const response = await event({ status: "RUNNING" });
      expect(response.status).toBe(422);
      expect((await response.json()).kind).toBe("insufficient_balance");
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
      ).toBe("READY");
      await expectNoWrites();
    } finally {
      await prisma.creditBucket.delete({ where: { id: personalBucket.id } });
      await prisma.transaction.delete({ where: { id: personalTopup.id } });
    }
  });

  it("allows a native public-only start without a paid ceiling or new Vendor grant", async () => {
    await markNativeTask();
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "READY" },
    });
    expect((await event({ status: "RUNNING" })).status).toBe(201);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
    ).toBe("RUNNING");
    expect(
      await prisma.vendorGrant.count({ where: { vendorId, workspaceId } }),
    ).toBe(0);
  });

  it("accepts a funded full-audit start from its frozen site limit without creating a charge", async () => {
    const analysis = await markNativeTask();
    const request = {
      version: 1,
      requestId: analysis.id,
      pageUrls: [SEO_TEST_PAGE, `${SEO_TEST_PAGE}/related`],
      limits: { usd: 0.33, seconds: 60 },
    };
    await prisma.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: { kind: "audit_full", request },
    });
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "READY",
        description: `seo_audit: ${JSON.stringify(request)}`,
      },
    });
    const topup = await prisma.transaction.create({
      data: { organizationId, amount: convertCreditsToCents(50) },
    });
    const bucket = await prisma.creditBucket.create({
      data: {
        organizationId,
        amount: topup.amount,
        sourceTransactionId: topup.id,
      },
    });
    try {
      expect((await event({ status: "RUNNING" })).status).toBe(201);
      expect(
        await prisma.transaction.count({
          where: { organizationId, amount: { lt: 0n } },
        }),
      ).toBe(0);
    } finally {
      await prisma.creditBucket.delete({ where: { id: bucket.id } });
      await prisma.transaction.delete({ where: { id: topup.id } });
    }
  });

  it("retains generic assigned Task authorization despite a denied Vendor grant", async () => {
    await vendorGrant("DENIED");
    expect((await event({ comment: "Generic assigned Task" })).status).toBe(
      201,
    );
    expect((await mint()).status).toBe(201);
    expect((await complete()).status).toBe(200);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
  });

  it("refuses an edited native SEO packet before provider work, even when its frozen ceiling is free", async () => {
    const analysis = await markNativeTask();
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "READY",
        description: `seo_job: ${JSON.stringify({ ...(analysis.request as object), budget: { maxProviderCalls: 20 } })}`,
      },
    });
    expect((await event({ status: "RUNNING" })).status).toBe(422);
    await expectNoWrites();
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
    ).toBe("READY");
  });

  it("refuses a generic or forged-packet Task on the global native SEO service before start", async () => {
    fixtureEnv.globalCoworkerId = coworkerId;
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "READY",
        description:
          'seo_job: {"kind":"page_check","budget":{"maxProviderCalls":0}}',
      },
    });
    for (const guarded of [true, false])
      expect((await event({ status: "RUNNING" }, guarded)).status).toBe(422);
    await expectNoWrites();
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status,
    ).toBe("READY");
  });

  it("retries a native SEO billing snapshot when revocation holds the grant first", async () => {
    await markNativeTask();
    const grant = await vendorGrant("GRANTED");
    let pending: Promise<Response> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        await revokeVendorGrantInWorkspace(
          { grantId: grant.id, workspaceId, resolvedById: ownerId },
          tx,
        );
        const [holder] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        pending = event({ credits: 1, comment: "Charge after revoke" });
        await waitForBlockedGrantWrite(holder.pid);
      });
      expect((await pending)?.status).toBe(403);
      await expectNoWrites();
    } finally {
      await pending?.catch(() => undefined);
    }
  });

  it("holds native SEO authorization through billing when the worker takes the grant first", async () => {
    await markNativeTask();
    const grant = await vendorGrant("GRANTED");
    let revoking: Promise<unknown> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        const task = await requireTaskWorkerContext(
          actor,
          taskId,
          expectedContext(),
          tx,
        );
        const [holder] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        revoking = prisma.$transaction((revoker) =>
          revokeVendorGrantInWorkspace(
            {
              grantId: grant.id,
              workspaceId,
              resolvedById: ownerId,
            },
            revoker,
          ),
        );
        await waitForBlockedGrantWrite(holder.pid);
        const cents = convertCreditsToCents(1);
        const transactionId = await createTaskEventTransaction({
          userId: task.ownerId,
          organizationId: task.organizationId,
          projectId: task.projectId,
          cents,
          tx,
        });
        await tx.taskEvent.create({
          data: {
            taskId,
            coworkerId,
            comment: "Authorized before revoke",
            cents,
            transactionId,
          },
        });
      });
      await revoking;
      const charges = await prisma.transaction.findMany({
        where: { organizationId, amount: { lt: 0n } },
      });
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({
        userId: ownerId,
        organizationId,
        amount: -convertCreditsToCents(1),
      });
      expect(
        (await event({ credits: 1, comment: "After revocation" })).status,
      ).toBe(403);
      expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(1);
    } finally {
      await revoking?.catch(() => undefined);
    }
  });

  it.each(["owner", "organization", "workspace", "assignee"] as const)(
    "rejects a stale %s before comments, files, participants or charges",
    async (change) => {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          ...(change === "owner" ? { ownerId: otherOwnerId } : {}),
          ...(change === "organization" ? { organizationId: null } : {}),
          ...(change === "workspace"
            ? { workspaceId: personalWorkspaceId }
            : {}),
          ...(change === "assignee" ? { assigneeId: siblingId } : {}),
        },
      });
      const response = await event({
        status: "COMPLETED",
        credits: 1,
        comment: `@reader [output](https://example.test/report.pdf)`,
        mentionedUserIds: [otherOwnerId],
      });
      expect(response.status).toBe(change === "assignee" ? 403 : 409);
      expect((await mint()).status).toBe(change === "assignee" ? 403 : 409);
      expect(grantMock).not.toHaveBeenCalled();
      await expectNoWrites();
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
          .organizationId,
      ).toBe(change === "organization" ? null : organizationId);
    },
  );

  it.each(["workspace", "assignee"] as const)(
    "waits for a concurrent %s change and rechecks before any debit",
    async (change) => {
      let pending: Promise<Response> | undefined;
      try {
        await prisma.$transaction(async (tx) => {
          await lockTaskRows(tx, [taskId]);
          const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          pending = event({ status: "COMPLETED", credits: 1 });
          await waitForBlockedTaskWrite(holder.pid);
          await tx.task.update({
            where: { id: taskId },
            data:
              change === "workspace"
                ? { workspaceId: personalWorkspaceId }
                : { assigneeId: siblingId },
          });
        });
        expect((await pending)?.status).toBe(change === "assignee" ? 403 : 409);
        await expectNoWrites();
      } finally {
        await pending?.catch(() => undefined);
      }
    },
  );

  it("requires all strict context assertions and rejects human actor substitution", async () => {
    for (const expected of [
      undefined,
      { ownerId, organizationId },
      { ...expectedContext(), assigneeId: coworkerId },
      { ...expectedContext(), workspaceId: "not-a-workspace" },
    ]) {
      expect(
        (await event({ comment: "Audit", expectedContext: expected })).status,
      ).toBe(422);
    }
    actor = { actor: "user", userId: ownerId, organizationId, role: "user" };
    expect((await event({ comment: "Audit" })).status).toBe(403);
    await expectNoWrites();
  });

  describe("failed SEO admission", () => {
    const comment = "This SEO audit could not start.";
    // Known-answer hash from the worker for name "Guarded Task delivery" and this input.
    const description = "Audit “café”\nSecond line";
    const fingerprint =
      "2161bb5b64a4801f2bd4b0490f807fd3332af53267982449304b175b253a48b1";
    let readyEventId: string;

    beforeEach(async () => {
      fixtureEnv.globalCoworkerId = coworkerId;
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "READY", description },
      });
      readyEventId = (
        await prisma.taskEvent.create({ data: { taskId, status: "READY" } })
      ).id;
    });

    const failAdmission = async (over: Record<string, unknown> = {}) =>
      app.request(`/v1/tasks/${taskId}/events/failed-admission-v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedContext: expectedContext(),
          expectedInputFingerprint: fingerprint,
          expectedStatus: "READY",
          expectedLastStatusEventId: readyEventId,
          comment,
          ...over,
        }),
      });

    it("writes one uncharged failure after intervening comments and rejects its replay", async () => {
      await prisma.taskEvent.create({ data: { taskId, comment: "Progress" } });
      const response = await failAdmission();
      expect(response.status).toBe(201);
      expect((await response.json()).data).toMatchObject({
        taskId,
        status: "FAILED",
        comment,
        credits: null,
      });
      expect((await failAdmission()).status).toBe(409);
      const events = await prisma.taskEvent.findMany({
        where: { taskId, status: "FAILED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        coworkerId,
        cents: null,
        transactionId: null,
      });
    });

    it("closes an input request only from its current status event", async () => {
      const inputRequest = await event({
        status: "INPUT_REQUIRED",
        comment: "Add the page URL.",
      });
      expect(inputRequest.status).toBe(201);
      const inputRequired = {
        expectedStatus: "INPUT_REQUIRED",
        expectedLastStatusEventId: (await inputRequest.json()).data.id,
      };
      expect((await failAdmission()).status).toBe(409);
      expect((await failAdmission(inputRequired)).status).toBe(201);
    });

    it.each(["input", "reopen"] as const)(
      "refuses a concurrent %s change before writing a failure",
      async (change) => {
        let pending: Promise<Response> | undefined;
        try {
          await prisma.$transaction(async (tx) => {
            await lockTaskRows(tx, [taskId]);
            const [holder] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            pending = failAdmission();
            await waitForBlockedTaskWrite(holder.pid);
            if (change === "input")
              await tx.task.update({
                where: { id: taskId },
                data: { description: "A different audit" },
              });
            else {
              await tx.taskEvent.create({ data: { taskId, status: "DRAFT" } });
              await tx.taskEvent.create({ data: { taskId, status: "READY" } });
              await tx.task.update({
                where: { id: taskId },
                data: { status: "READY" },
              });
            }
          });
          expect((await pending)?.status).toBe(409);
          expect(
            (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
              .status,
          ).toBe("READY");
          expect(
            await prisma.taskEvent.count({
              where: { taskId, status: "FAILED" },
            }),
          ).toBe(0);
        } finally {
          await pending?.catch(() => undefined);
        }
      },
    );

    it("only accepts the configured SEO worker, the exact workspace and an unpriced failure", async () => {
      expect(
        (
          await failAdmission({
            expectedContext: {
              ...expectedContext(),
              workspaceId: personalWorkspaceId,
            },
          })
        ).status,
      ).toBe(403);
      expect((await failAdmission({ credits: 9 })).status).toBe(422);
      expect((await failAdmission({ status: "COMPLETED" })).status).toBe(422);
      fixtureEnv.globalCoworkerId = siblingId;
      expect((await failAdmission()).status).toBe(403);
      expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(1);
    });
  });

  it("keeps ordinary intake/help comments and the existing status rules", async () => {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "READY" },
    });
    expect((await event({ comment: "Please select a page" })).status).toBe(201);
    expect(
      (await event({ status: "INPUT_REQUIRED", comment: "Add a URL" })).status,
    ).toBe(201);
    expect((await event({ comment: "The page URL is required" })).status).toBe(
      201,
    );
    expect((await event({ status: "RUNNING" })).status).toBe(201);
    expect((await event({ status: "RUNNING", credits: 1 })).status).toBe(422);
    expect(
      await prisma.transaction.count({
        where: { organizationId, amount: { lt: 0n } },
      }),
    ).toBe(0);
  });

  it("uses the existing ledger for a valid guarded completion", async () => {
    expect((await event({ status: "COMPLETED", credits: 1 })).status).toBe(201);
    const charge = await prisma.transaction.findFirstOrThrow({
      where: { organizationId, amount: { lt: 0n } },
    });
    expect(charge).toMatchObject({
      userId: ownerId,
      amount: -convertCreditsToCents(1),
    });
    expect(
      await prisma.taskEvent.count({
        where: { taskId, transactionId: charge.id },
      }),
    ).toBe(1);
  });

  it.each(["owner", "workspace", "assignee", "archive"] as const)(
    "discards a signed unlinked upload after a %s change",
    async (change) => {
      const response = await mint();
      expect(response.status).toBe(201);
      expect((await response.json()).data.contextVersion).toBe(1);
      expect(grantInput?.onUploadCompleted?.callbackUrl).toBe(
        `https://core.example.test${CALLBACK_PATH}`,
      );
      expect(
        JSON.parse(grantInput!.onUploadCompleted!.tokenPayload).contextBinding,
      ).toEqual({
        contextVersion: 1,
        expectedContext: expectedContext(),
        coworkerId,
        vendorId,
      });
      await prisma.task.update({
        where: { id: taskId },
        data: {
          ...(change === "owner" ? { ownerId: otherOwnerId } : {}),
          ...(change === "workspace"
            ? { workspaceId: personalWorkspaceId }
            : {}),
          ...(change === "assignee" ? { assigneeId: siblingId } : {}),
          ...(change === "archive" ? { archivedAt: new Date() } : {}),
        },
      });
      expect((await complete()).status).toBe(200);
      await expectNoWrites();
      expect(delMock).not.toHaveBeenCalled();
    },
  );

  it("rechecks signed file context after waiting for a concurrent Workspace move", async () => {
    expect((await mint()).status).toBe(201);
    let pending: Promise<Response> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        await lockTaskRows(tx, [taskId]);
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        pending = complete();
        await waitForBlockedTaskWrite(holder.pid);
        await tx.task.update({
          where: { id: taskId },
          data: { workspaceId: personalWorkspaceId },
        });
      });
      expect((await pending)?.status).toBe(200);
      await expectNoWrites();
      expect(delMock).not.toHaveBeenCalled();
    } finally {
      await pending?.catch(() => undefined);
    }
  });

  it("never deletes a Blob that another callback can link after the Task moves back", async () => {
    expect((await mint()).status).toBe(201);
    await prisma.task.update({
      where: { id: taskId },
      data: { workspaceId: personalWorkspaceId },
    });
    let blobDeleted = false;
    delMock.mockImplementation(async () => {
      // Reproduce the old cleanup race at the real Blob deletion boundary.
      await prisma.task.update({
        where: { id: taskId },
        data: { workspaceId },
      });
      expect((await complete()).status).toBe(200);
      blobDeleted = true;
    });
    expect((await complete()).status).toBe(200);
    if (!blobDeleted) {
      await prisma.task.update({
        where: { id: taskId },
        data: { workspaceId },
      });
      expect((await complete()).status).toBe(200);
    }
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
    expect(blobDeleted).toBe(false);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures, missing bindings and callback downgrades", async () => {
    expect((await mint()).status).toBe(201);
    expect((await complete({ validSignature: false })).status).toBe(400);
    const payload = JSON.parse(grantInput!.onUploadCompleted!.tokenPayload);
    delete payload.contextBinding;
    expect((await complete({ payload: JSON.stringify(payload) })).status).toBe(
      400,
    );
    expect((await complete({ path: LEGACY_CALLBACK_PATH })).status).toBe(400);
    await expectNoWrites();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("keeps linked history on late retries and never downgrades guarded callbacks", async () => {
    expect((await mint()).status).toBe(201);
    expect((await complete()).status).toBe(200);
    await prisma.task.update({
      where: { id: taskId },
      data: { workspaceId: personalWorkspaceId, assigneeId: siblingId },
    });
    expect((await complete()).status).toBe(200);
    expect((await complete({ path: LEGACY_CALLBACK_PATH })).status).toBe(400);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("never interprets a malformed signed binding as a legacy orphan", async () => {
    expect((await mint()).status).toBe(201);
    expect((await complete()).status).toBe(200);
    const payload = JSON.parse(grantInput!.onUploadCompleted!.tokenPayload);
    payload.contextBinding.contextVersion = 2;
    expect(
      (
        await complete({
          payload: JSON.stringify(payload),
          path: LEGACY_CALLBACK_PATH,
        })
      ).status,
    ).toBe(400);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("retries SEO import after a prior callback linked the file but artifact reading failed", async () => {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED" },
    });
    const audit = await prisma.seoAudit.create({
      data: { workspaceId, name: "Upload retry", createdById: ownerId },
    });
    const analysis = await prisma.projectSeoAnalysis.create({
      data: {
        auditId: audit.id,
        idempotencyKey: randomUUID(),
        requestHash: "worker-retry-fixture",
        kind: "page_check",
        taskId,
        pageIds: [],
        requestedBy: ownerId,
        request: {
          pageUrls: [SEO_TEST_PAGE],
          countryCode: "US",
          languageCode: "en",
          keywords: [],
          devices: ["desktop"],
        },
      },
    });
    const report = { ...focusedReport(), requestId: analysis.id };
    const readArtifact = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transient artifact read failure"))
      .mockResolvedValue(
        new Response(JSON.stringify(report), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", readArtifact);
    expect((await mint()).status).toBe(201);
    expect((await complete()).status).toBe(500);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
    expect((await complete()).status).toBe(200);
    expect(
      await prisma.projectSeoObservation.count({
        where: { auditId: audit.id, sourceTaskId: taskId },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.projectSeoAnalysis.findUniqueOrThrow({
          where: { id: analysis.id },
        })
      ).status,
    ).toBe("completed");
    expect(delMock).not.toHaveBeenCalled();
    expect(readArtifact).toHaveBeenCalledTimes(2);
  });

  it("retains legacy event, grant and callback behavior without context", async () => {
    expect((await event({ comment: "Legacy delivery" }, false)).status).toBe(
      201,
    );
    const response = await mint(false);
    expect(response.status).toBe(201);
    expect((await response.json()).data.contextVersion).toBeUndefined();
    expect((await complete({ path: LEGACY_CALLBACK_PATH })).status).toBe(200);
    expect(await prisma.taskFile.count({ where: { taskId } })).toBe(1);
  });
});
