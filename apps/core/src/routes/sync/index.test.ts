import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireLockMock,
  syncFreeSubscriptionRenewalMock,
  releaseLockMock,
  syncAgentSummariesMock,
  syncJobsMock,
  syncJobSchedulesMock,
  syncRegistryAgentsMock,
  syncSourceImportMock,
  syncStripeCustomersMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  syncFreeSubscriptionRenewalMock: vi.fn(),
  releaseLockMock: vi.fn(),
  syncAgentSummariesMock: vi.fn(),
  syncJobsMock: vi.fn(),
  syncJobSchedulesMock: vi.fn(),
  syncRegistryAgentsMock: vi.fn(),
  syncSourceImportMock: vi.fn(),
  syncStripeCustomersMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "test-cron-secret",
    LOCK_TIMEOUT: 5000,
    LOCK_TIMEOUT_BUFFER: 1000,
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

vi.mock("@/services/source-import-sync.service", () => ({
  sourceImportSyncService: {
    importPendingResultBlobs: syncSourceImportMock,
  },
}));

vi.mock("@/services/free-subscription-sync.service", () => ({
  freeSubscriptionSyncService: {
    renewLocalFreeSubscriptions: syncFreeSubscriptionRenewalMock,
  },
}));

vi.mock("@/services/job-schedule-sync.service", () => ({
  jobScheduleSyncService: {
    executeDueSchedules: syncJobSchedulesMock,
  },
}));

vi.mock("@/services/job-sync.service", () => ({
  jobSyncService: {
    syncUnfinishedJobs: syncJobsMock,
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

/** Returns a promise and its resolver so tests can resolve the promise when needed. */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
    syncJobsMock.mockResolvedValue({
      processed: 0,
      unfinishedFound: 0,
      durationMs: 0,
    });
    syncJobSchedulesMock.mockResolvedValue({
      dueFound: 0,
      processed: 0,
      paused: 0,
      skippedLocked: 0,
      durationMs: 0,
    });
    syncSourceImportMock.mockResolvedValue(3);
    syncFreeSubscriptionRenewalMock.mockResolvedValue(undefined);
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

  it("returns 401 for missing cron auth on job schedules sync", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/job-schedules");

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobSchedulesMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth on job schedules sync", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/job-schedules", {
      headers: {
        Authorization: "Bearer invalid",
      },
    });

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobSchedulesMock).not.toHaveBeenCalled();
  });

  it("returns 401 for missing cron auth on jobs sync", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/jobs");

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth on jobs sync", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer invalid",
      },
    });

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when job schedules sync lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = await createApp();

    const response = await app.request("http://localhost/sync/job-schedules", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(409);
    expect(syncJobSchedulesMock).not.toHaveBeenCalled();
  });

  it("returns 409 when jobs sync lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = await createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(409);
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts registry sync exactly once in background", async () => {
    const deferred = createDeferred();
    syncRegistryAgentsMock.mockImplementation(() => deferred.promise);
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

    deferred.resolve();
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

  it("returns 200 and starts free-subscription renewal sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request(
      "http://localhost/sync/free-subscriptions-renewal",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "free-subscriptions-renewal-sync",
    );

    await flushMicrotasks();
    expect(syncFreeSubscriptionRenewalMock).toHaveBeenCalledTimes(1);
    expect(syncFreeSubscriptionRenewalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineMs: expect.any(Number),
        msRemaining: expect.any(Function),
        shouldContinue: expect.any(Function),
      }),
    );
  });

  it("returns 200 and starts source import sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/source-import", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("source-import-sync");

    await flushMicrotasks();
    expect(syncSourceImportMock).toHaveBeenCalledTimes(1);
    expect(syncSourceImportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(Object),
        deadlineMs: expect.any(Number),
        shouldContinue: expect.any(Function),
      }),
    );
  });

  it("returns 200 and starts jobs sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("jobs-sync");

    await flushMicrotasks();
    expect(syncJobsMock).toHaveBeenCalledTimes(1);
    expect(syncJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(Object),
        deadlineMs: expect.any(Number),
        shouldContinue: expect.any(Function),
      }),
    );
  });

  it("returns 200 and starts job schedules sync exactly once in background", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/job-schedules", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("job-schedules-sync");

    await flushMicrotasks();
    expect(syncJobSchedulesMock).toHaveBeenCalledTimes(1);
    expect(syncJobSchedulesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(Object),
        deadlineMs: expect.any(Number),
        shouldContinue: expect.any(Function),
      }),
    );
  });

  it("releases source import lock when sync exceeds timeout budget", async () => {
    vi.useFakeTimers();

    try {
      syncSourceImportMock.mockImplementation(
        (options: { abortSignal: AbortSignal }) =>
          new Promise<number>((resolve) => {
            options.abortSignal.addEventListener("abort", () => {
              resolve(0);
            });
          }),
      );
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const app = await createApp();
        const response = await app.request(
          "http://localhost/sync/source-import",
          {
            headers: {
              Authorization: "Bearer test-cron-secret",
            },
          },
        );

        expect(response.status).toBe(200);
        await flushPromises();
        expect(syncSourceImportMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4000);
        await flushPromises();

        expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
        expect(releaseLockMock).toHaveBeenCalledTimes(1);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases jobs lock when sync exceeds timeout budget", async () => {
    vi.useFakeTimers();

    try {
      syncJobsMock.mockImplementation(
        (options: { abortSignal: AbortSignal }) =>
          new Promise<{
            durationMs: number;
            processed: number;
            unfinishedFound: number;
          }>((resolve) => {
            options.abortSignal.addEventListener("abort", () => {
              resolve({
                durationMs: 0,
                processed: 0,
                unfinishedFound: 0,
              });
            });
          }),
      );
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const app = await createApp();
        const response = await app.request("http://localhost/sync/jobs", {
          headers: {
            Authorization: "Bearer test-cron-secret",
          },
        });

        expect(response.status).toBe(200);
        await flushPromises();
        expect(syncJobsMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4000);
        await flushPromises();

        expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
        expect(releaseLockMock).toHaveBeenCalledTimes(1);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
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

  it("does not release lock when a long-running sync ignores cancellation", async () => {
    vi.useFakeTimers();

    try {
      syncRegistryAgentsMock.mockImplementation(
        (_options: { abortSignal: AbortSignal }) =>
          new Promise<void>(() => {
            // Intentionally never resolves.
          }),
      );
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const app = await createApp();
        const response = await app.request("http://localhost/sync/agents", {
          headers: {
            Authorization: "Bearer test-cron-secret",
          },
        });

        expect(response.status).toBe(200);
        await flushPromises();
        expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4000);
        await flushPromises();

        expect(releaseLockMock).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases lock when a long-running sync cooperatively cancels", async () => {
    vi.useFakeTimers();

    try {
      syncRegistryAgentsMock.mockImplementation(
        (options: { abortSignal: AbortSignal }) =>
          new Promise<void>((resolve) => {
            options.abortSignal.addEventListener("abort", () => {
              resolve();
            });
          }),
      );
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const app = await createApp();
        const response = await app.request("http://localhost/sync/agents", {
          headers: {
            Authorization: "Bearer test-cron-secret",
          },
        });

        expect(response.status).toBe(200);
        await flushPromises();
        expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4000);
        await flushPromises();

        expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
        expect(releaseLockMock).toHaveBeenCalledTimes(1);
      } finally {
        consoleErrorSpy.mockRestore();
      }
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
