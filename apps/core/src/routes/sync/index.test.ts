import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireLockMock,
  releaseLockMock,
  syncAgentSummariesMock,
  syncRegistryAgentsMock,
  syncStripeCustomersMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  syncAgentSummariesMock: vi.fn(),
  syncRegistryAgentsMock: vi.fn(),
  syncStripeCustomersMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "test-cron-secret",
  }),
}));

vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: {
    acquireLock: acquireLockMock,
    releaseLock: releaseLockMock,
  },
}));

vi.mock("@/services/agent-sync.service", () => ({
  AGENTS_SYNC_LOCK_KEY: "agents-sync",
  AGENTS_SUMMARY_SYNC_LOCK_KEY: "agents-summary-sync",
  agentSyncService: {
    syncRegistryAgents: syncRegistryAgentsMock,
    syncAgentSummaries: syncAgentSummariesMock,
  },
}));

vi.mock("@/services/stripe-customer-sync.service", () => ({
  stripeCustomerSyncService: {
    syncAllStripeCustomers: syncStripeCustomersMock,
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
}));

async function createApp() {
  const { default: syncRouter } = await import("./index");
  const app = new Hono();
  app.route("/sync", syncRouter);
  return app;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sync routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLockMock.mockResolvedValue({
      key: "lock-key",
      ownerToken: "owner-token",
    });
    releaseLockMock.mockResolvedValue(true);
    syncRegistryAgentsMock.mockResolvedValue(undefined);
    syncAgentSummariesMock.mockResolvedValue(undefined);
    syncStripeCustomersMock.mockResolvedValue(undefined);
  });

  it("returns 401 for missing cron auth", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/agents");

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer invalid",
      },
    });

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = await createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(409);
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts registry sync exactly once in background", async () => {
    let resolveSync: (() => void) | null = null;
    syncRegistryAgentsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const app = await createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("agents-sync");

    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
    expect(releaseLockMock).not.toHaveBeenCalled();

    resolveSync?.();
    await flushMicrotasks();
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("returns 200 and starts summary sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/agents-summary", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("agents-summary-sync");

    await flushMicrotasks();
    expect(syncAgentSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and starts stripe customer sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request(
      "http://localhost/sync/stripe-customers",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("stripe-customers-sync");

    await flushMicrotasks();
    expect(syncStripeCustomersMock).toHaveBeenCalledTimes(1);
  });

  it("does not release lock while long-running sync is still pending", async () => {
    vi.useFakeTimers();

    try {
      let resolveSync: (() => void) | null = null;
      syncRegistryAgentsMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSync = resolve;
          }),
      );

      const app = await createApp();
      const response = await app.request("http://localhost/sync/agents", {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      });

      expect(response.status).toBe(200);
      await flushPromises();
      expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(95000);
      await flushPromises();

      expect(releaseLockMock).not.toHaveBeenCalled();

      resolveSync?.();
      await flushPromises();
      expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
      expect(releaseLockMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears background timers when sync fails", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      syncRegistryAgentsMock.mockRejectedValue(new Error("sync failed fast"));

      const app = await createApp();
      const response = await app.request("http://localhost/sync/agents", {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      });

      expect(response.status).toBe(200);
      await flushPromises();

      expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      consoleErrorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
