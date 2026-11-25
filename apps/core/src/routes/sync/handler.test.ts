import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";

const { acquireLock, captureCheckIn, flush, pending, releaseLock } = vi.hoisted(
  () => ({
    acquireLock: vi.fn(),
    captureCheckIn: vi.fn((..._args: unknown[]) => "check-in-id"),
    flush: vi.fn(async () => true),
    pending: [] as Promise<unknown>[],
    releaseLock: vi.fn(async () => true),
  }),
);

vi.mock("@sentry/node", () => ({ captureCheckIn, flush }));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((work: Promise<unknown>) => {
    pending.push(work);
  }),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "secret",
    LOCK_TIMEOUT: 300_000,
    LOCK_TIMEOUT_BUFFER: 10_000,
  }),
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock, releaseLock },
}));

import { handleSyncRequest, type SyncRequestOptions } from "./handler";

/** A cron Vercel runs every ten minutes (`vercel.json`). */
const PATH = "/sync/cmo-production";

async function run(
  operation: Parameters<typeof handleSyncRequest>[2],
  options?: SyncRequestOptions,
  path = PATH,
): Promise<Response> {
  const app = new Hono();
  app.get(path, (c) => handleSyncRequest(c, "lock-key", operation, options));
  const response = await app.request(`http://localhost${path}`, {
    headers: { Authorization: "Bearer secret" },
  });
  await Promise.all(pending.splice(0));
  return response;
}

const finished = () =>
  captureCheckIn.mock.calls
    .map(([checkIn]) => checkIn as { status: string })
    .filter((checkIn) => checkIn.status !== "in_progress")
    .map((checkIn) => checkIn.status);

describe("cron monitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue({ key: "lock-key", ownerToken: "owner" });
  });

  it("checks a run in with its vercel.json schedule, then ok, and flushes", async () => {
    await run(async () => undefined);

    expect(captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "lock-key", status: "in_progress" },
      expect.objectContaining({
        schedule: { type: "crontab", value: "*/10 * * * *" },
        failureIssueThreshold: 3,
        maxRuntime: 6,
      }),
    );
    expect(captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "lock-key",
      status: "ok",
      duration: expect.any(Number),
    });
    expect(flush).toHaveBeenCalled();
  });

  it("fails the check-in of a sync that threw", async () => {
    expectCoreLog("error", "A scheduled sync failed");
    await run(async () => {
      throw new Error("boom");
    });
    expect(finished()).toEqual(["error"]);
  });

  it("fails an opted-in run that reports no work, so N idle runs open an issue", async () => {
    await run(async ({ reportWork }) => reportWork(0), { idleRunsAlert: 6 });
    expect(captureCheckIn.mock.calls[0]?.[1]).toMatchObject({
      failureIssueThreshold: 6,
    });
    expect(finished()).toEqual(["error"]);

    captureCheckIn.mockClear();
    await run(async ({ reportWork }) => reportWork(4), { idleRunsAlert: 6 });
    expect(finished()).toEqual(["ok"]);
  });

  it("does not fail an idle run of a sync that did not opt in", async () => {
    await run(async ({ reportWork }) => reportWork(0));
    expect(finished()).toEqual(["ok"]);
  });

  it("tells the monitor a cron is alive when the last run still holds the lock", async () => {
    acquireLock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const response = await run(async () => undefined);
    expect(response.status).toBe(409);
    expect(captureCheckIn.mock.calls).toEqual([
      [{ monitorSlug: "lock-key", status: "ok" }],
    ]);
  });

  it("has no monitor for a path Vercel does not schedule", async () => {
    await run(async () => undefined, undefined, "/sync/not-scheduled");
    expect(captureCheckIn).not.toHaveBeenCalled();
  });
});
