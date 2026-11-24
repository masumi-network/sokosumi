import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreLogEvents } from "@/test/core-log";
import mountSyncSocialPerformance from "./get";

vi.mock("@/services/project-social-connections.service", () => ({
  cleanExpiredZernioIntents: vi
    .fn()
    .mockResolvedValue({ cleaned: 0, failed: 0 }),
}));

const collect = vi.hoisted(() => vi.fn());

vi.mock("@/services/social-account-sync", () => ({
  runDueSocialAccountSync: collect,
}));

vi.mock("../handler.js", () => ({
  handleSyncRequest: async (
    c: { json: (body: unknown) => Response },
    _lockKey: string,
    operation: (context: {
      abortSignal: AbortSignal;
      deadlineMs: number;
      msRemaining: () => number;
      shouldContinue: () => boolean;
      log: import("../handler.js").SyncRunContext["log"];
    }) => Promise<void>,
  ) => {
    // The run's event, as the real handler sends it when the run ends.
    const { createCoreLogger } = await import("@/lib/evlog");
    const log = createCoreLogger({ operation: "cron_sync" });
    await operation({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
      log,
    });
    log.emit();
    return c.json({ ok: true });
  },
}));

describe("GET /sync/social-performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collect.mockResolvedValue({
      accountsProcessed: 2,
      pagesCollected: 3,
      accountsCompleted: 1,
      accountsFailed: 1,
      accountsSkippedReauth: 0,
      accountsSkippedBackoff: 0,
      rateLimitHits: 0,
    });
  });

  it("logs collected and failed counts from the writer", async () => {
    const app = new Hono();
    mountSyncSocialPerformance(app);
    const response = await app.request("http://localhost/social-performance");
    expect(response.status).toBe(200);
    expect(collect).toHaveBeenCalledOnce();
    expect(coreLogEvents()).toEqual([
      expect.objectContaining({
        operation: "cron_sync",
        result: expect.objectContaining({ refreshed: 2, failed: 1 }),
      }),
    ]);
  });
});
