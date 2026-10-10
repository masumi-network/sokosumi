import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import mountSyncSocialPerformance from "./get";

const collect = vi.hoisted(() => vi.fn());

vi.mock("@/services/social-account-sync", () => ({
  collectSocialPerformance: collect,
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
    }) => Promise<void>,
  ) => {
    await operation({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
    });
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
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = new Hono();
    mountSyncSocialPerformance(app);
    const response = await app.request("http://localhost/social-performance");
    expect(response.status).toBe(200);
    expect(collect).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      "[sync/social-performance-sync] collected",
      expect.objectContaining({ refreshed: 2, failed: 1 }),
    );
    info.mockRestore();
  });
});
