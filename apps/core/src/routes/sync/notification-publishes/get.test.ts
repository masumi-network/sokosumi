import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retry, acquire, release, pending } = vi.hoisted(() => ({
  retry: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 5000,
    LOCK_TIMEOUT_BUFFER: 1000,
  }),
}));
vi.mock("@/services/notification-publish-sync.service", () => ({
  retryNotificationPublishes: retry,
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (work: Promise<unknown>) => {
    pending.push(work);
  },
}));

import mount from "./get";

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  acquire.mockResolvedValue({
    key: "notification-publishes-sync",
    ownerToken: "owner",
  });
  release.mockResolvedValue(true);
  retry.mockResolvedValue({ examined: 1, published: 1, skipped: 0 });
});

describe("notification publish cron", () => {
  it("requires the cron secret before starting retries", async () => {
    const app = new Hono();
    mount(app);
    expect((await app.request("/notification-publishes")).status).toBe(401);
    expect(
      (
        await app.request("/notification-publishes", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect(retry).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });
  it("runs under the shared sync lock and releases it", async () => {
    const app = new Hono();
    mount(app);
    expect(
      (
        await app.request("/notification-publishes", {
          headers: { authorization: "Bearer test-secret" },
        })
      ).status,
    ).toBe(200);
    await Promise.all(pending);
    expect(acquire).toHaveBeenCalledWith("notification-publishes-sync");
    expect(retry).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      shouldContinue: expect.any(Function),
    });
    expect(release).toHaveBeenCalledWith(
      "notification-publishes-sync",
      "owner",
    );
  });
});
