import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPost from "./post.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  requeueFileIndexJobMock,
  nudgeFileIndexingMock,
  findFirstMock,
  loadEditableResourceMock,
  resolveFileRequestContextMock,
} = vi.hoisted(() => ({
  requeueFileIndexJobMock: vi.fn(),
  nudgeFileIndexingMock: vi.fn(),
  findFirstMock: vi.fn(),
  loadEditableResourceMock: vi.fn(),
  resolveFileRequestContextMock: vi.fn(),
}));

vi.mock("@/lib/files/index-jobs", () => ({
  requeueFileIndexJob: requeueFileIndexJobMock,
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: nudgeFileIndexingMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { fileIndexJob: { findFirst: findFirstMock } },
}));
vi.mock("@/services/file-metadata.service", () => ({
  assertFileEditAllowed: vi.fn(),
  loadEditableResource: loadEditableResourceMock,
}));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: resolveFileRequestContextMock,
}));

const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("requestId", "req_123");
    await next();
  });
  mountPost(app);
  return app;
}

async function reindex() {
  return createApp().request(`/${RESOURCE_ID}/reindex?scope=me`, {
    method: "POST",
  });
}

beforeEach(() => {
  requeueFileIndexJobMock
    .mockReset()
    .mockResolvedValue({ jobId: "job_1", queued: true, generation: 2 });
  nudgeFileIndexingMock.mockReset();
  findFirstMock.mockReset().mockResolvedValue(null);
  loadEditableResourceMock.mockReset().mockResolvedValue({
    id: RESOURCE_ID,
    contentRevision: 3,
  });
  resolveFileRequestContextMock.mockReset().mockResolvedValue({
    workspaceId: "ws_1",
    scope: "user",
    ownerId: "user_123",
    actor: { userId: "user_123", organizationId: null, kind: "interactive" },
  });
});

/**
 * Reindex queued work that nothing drained.
 *
 * `nudgeFileIndexing` had exactly one caller, the upload finalize route,
 * and nothing else leases these jobs except the cron — which Vercel runs
 * on production deployments only. So on a preview this route returned
 * `{ queued: true }`, a 200, and did nothing at all.
 *
 * Production swept it a minute later, which is why the effect was
 * preview-only. It still matters: reindex is the recovery path for a
 * document whose labels came out wrong, and a recovery path that needs a
 * cron cycle before anything happens is one a person presses twice.
 *
 * These assert the drain is triggered *by the route*. A test that only
 * checked for a 200 passed throughout the period the route did nothing.
 */
describe("POST /{id}/reindex", () => {
  it("drains the work it just queued", async () => {
    const response = await reindex();

    expect(response.status).toBe(200);
    expect(requeueFileIndexJobMock).toHaveBeenCalledTimes(1);
    expect(nudgeFileIndexingMock).toHaveBeenCalledTimes(1);
  });

  it("queues before it drains", async () => {
    // Nudging first would race the job it is meant to pick up: the
    // drain could lease nothing and return before the row exists.
    const order: string[] = [];
    requeueFileIndexJobMock.mockImplementation(async () => {
      order.push("requeue");
      return { jobId: "job_1", queued: true, generation: 2 };
    });
    nudgeFileIndexingMock.mockImplementation(() => {
      order.push("nudge");
    });

    await reindex();

    expect(order).toEqual(["requeue", "nudge"]);
  });

  it("says it queued, and says so only when it did", async () => {
    /**
     * The route answered `{ queued: true }` unconditionally. For a
     * document whose extraction and labelling had both succeeded — the
     * case this route exists for — it had queued nothing at all.
     */
    const response = await reindex();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { queued: true, outcome: "queued" },
    });
  });

  it("reports already-pending without claiming it queued anything", async () => {
    // Pressing the button twice must not read as two pieces of queued
    // work, and must not spend a second drain on a queue another runner
    // already holds.
    requeueFileIndexJobMock.mockResolvedValue({
      jobId: "job_1",
      queued: false,
      generation: 2,
    });

    const response = await reindex();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { queued: false, outcome: "already-pending" },
    });
    /**
     * Drained anyway, and this is the assertion that matters.
     *
     * Skipping the nudge here looks like a saving and is a
     * regression. The nudge is capped, so it routinely leaves work
     * QUEUED, and on a preview there is no cron — upload finalize
     * and this route are the only drains that exist. A document left
     * queued by a capped upload nudge is exactly what someone
     * presses reindex for, and a guard on `queued` would decline to
     * drain it. A duplicate runner is a no-op by construction, so
     * there was nothing to save.
     */
    expect(nudgeFileIndexingMock).toHaveBeenCalledTimes(1);
  });

  it("does not drain when the cooldown refuses the request", async () => {
    /**
     * The rate limit has to stay in front of the nudge, or an explicit
     * user action becomes an unmetered way to spend the provider budget:
     * the nudge drains up to three paid label evaluations.
     */
    findFirstMock.mockResolvedValue({ id: "job_recent" });

    const response = await reindex();

    expect(response.status).toBe(429);
    expect(requeueFileIndexJobMock).not.toHaveBeenCalled();
    expect(nudgeFileIndexingMock).not.toHaveBeenCalled();
  });

  it("does not drain for a document the caller cannot reach", async () => {
    loadEditableResourceMock.mockResolvedValue(null);

    const response = await reindex();

    expect(response.status).toBe(404);
    expect(nudgeFileIndexingMock).not.toHaveBeenCalled();
  });
});
