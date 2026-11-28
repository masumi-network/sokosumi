import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const {
  acquireLockMock,
  syncCardanoV2RailReadinessMock,
  syncCalendarInvalidationsMock,
  syncEnterpriseContractRenewalMock,
  syncFreeSubscriptionRenewalMock,
  releaseLockMock,
  syncAgentSummariesMock,
  syncJobsMock,
  syncRegistryAgentsMock,
  syncSourceImportMock,
  syncStripeCustomersMock,
  syncX402BuySideReadinessMock,
  expireStalePendingInvitationsMock,
  prismaTransactionMock,
  sendFollowUpsMock,
  purgeExpiredTaskX402PaymentHeadersMock,
  purgeExpiredVerificationsMock,
  syncProjectClosesMock,
  syncPolarYearlyGrantsMock,
  retryOwedPolarRevokesMock,
  releaseDueTaskSchedulesMock,
  releaseDueRunAtsMock,
} = vi.hoisted(() => ({
  releaseDueTaskSchedulesMock: vi.fn(),
  releaseDueRunAtsMock: vi.fn(),
  acquireLockMock: vi.fn(),
  syncCardanoV2RailReadinessMock: vi.fn(),
  syncCalendarInvalidationsMock: vi.fn(),
  syncPolarYearlyGrantsMock: vi.fn(),
  retryOwedPolarRevokesMock: vi.fn(),
  syncEnterpriseContractRenewalMock: vi.fn(),
  syncFreeSubscriptionRenewalMock: vi.fn(),
  releaseLockMock: vi.fn(),
  syncAgentSummariesMock: vi.fn(),
  syncJobsMock: vi.fn(),
  syncRegistryAgentsMock: vi.fn(),
  syncSourceImportMock: vi.fn(),
  syncStripeCustomersMock: vi.fn(),
  syncX402BuySideReadinessMock: vi.fn(),
  expireStalePendingInvitationsMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  sendFollowUpsMock: vi.fn(),
  purgeExpiredTaskX402PaymentHeadersMock: vi.fn(),
  purgeExpiredVerificationsMock: vi.fn(),
  syncProjectClosesMock: vi.fn(),
}));

/** The mocked `LOCK_TIMEOUT`, which the env mock below hands the handler. */
const LOCK_TIMEOUT_MS = 5000;
/** The mocked `LOCK_TIMEOUT_BUFFER`, held back so the lock outlives the run. */
const LOCK_TIMEOUT_BUFFER_MS = 1000;
/**
 * What the handler gives a sync run before it cancels it.
 *
 * The handler floors this at a minimum of its own, so the two above are
 * chosen to land above that floor and this stays the deciding number.
 */
const SYNC_DEADLINE_MS = LOCK_TIMEOUT_MS - LOCK_TIMEOUT_BUFFER_MS;

vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      CRON_SECRET: "test-cron-secret",
      LOCK_TIMEOUT: LOCK_TIMEOUT_MS,
      LOCK_TIMEOUT_BUFFER: LOCK_TIMEOUT_BUFFER_MS,
    }),
  };
});

vi.mock("@/services/social-post-publisher.service", () => ({
  publishDueSocialPosts: vi.fn().mockResolvedValue({
    claimed: 0,
    published: 0,
    retried: 0,
    failed: 0,
    missed: 0,
    skipped: 0,
  }),
}));

vi.mock("@/services/social-account-sync", () => ({
  runDueSocialAccountSync: vi.fn().mockResolvedValue({
    accountsProcessed: 0,
    pagesCollected: 0,
    accountsCompleted: 0,
    accountsFailed: 0,
    accountsSkippedReauth: 0,
    accountsSkippedBackoff: 0,
    rateLimitHits: 0,
  }),
  scheduleSocialAccountRefresh: vi.fn(),
  requestSocialAccountRefresh: vi.fn(),
}));

const refreshSkillCatalogMock = vi.hoisted(() => vi.fn());
const failSeoAnalysesOfEndedTasksMock = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("@/services/skill-catalog.service", () => ({
  refreshSkillCatalog: refreshSkillCatalogMock,
}));

/**
 * What Prisma throws for an invalid write: the message quotes the call's
 * arguments, here external text with a private sentinel and a secret.
 */
function prismaValidationError() {
  const error = new Error(
    'Invalid `prisma.skill.upsert()` invocation:\n{ data: { name: "PRIVATE-SENTINEL notes", description: "key sk_live_abc123", installs: 99999999999999999999 } }\nArgument `installs`: Value out of range for the type.',
  );
  error.name = "PrismaClientValidationError";
  return error;
}

vi.mock("@/services/notification-publish-sync.service", () => ({
  retryNotificationPublishes: vi
    .fn()
    .mockResolvedValue({ examined: 0, published: 0, skipped: 0 }),
}));

vi.mock("@/services/notification-follow-up-sync.service", () => ({
  notificationFollowUpSyncService: {
    sendFollowUps: sendFollowUpsMock,
  },
}));

vi.mock("@/services/coworker-late-responses-sync.service", () => ({
  syncLateCoworkerResponses: vi.fn(async () => ({
    delivered: 0,
    dropped: 0,
    waiting: 0,
  })),
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
    syncCardanoV2RailReadiness: syncCardanoV2RailReadinessMock,
  },
}));

vi.mock("@/services/agent-sync.x402-readiness", () => ({
  syncX402BuySideReadiness: syncX402BuySideReadinessMock,
}));

vi.mock("@/services/source-import-sync.service", () => ({
  sourceImportSyncService: {
    importPendingResultBlobs: syncSourceImportMock,
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    runEnterpriseContractSchedulerPass: (...args: unknown[]) =>
      syncEnterpriseContractRenewalMock(...args),
  };
});

const networkClients = vi.hoisted(() => ({ mainnet: { side: "mainnet" } }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
  networkPrisma: (network: keyof typeof networkClients) =>
    networkClients[network],
}));

vi.mock("@/services/polar-yearly-grant-sync.service", () => ({
  syncPolarYearlyGrants: syncPolarYearlyGrantsMock,
}));

vi.mock("@/services/polar-subscription-end.service", () => ({
  retryOwedPolarRevokes: retryOwedPolarRevokesMock,
}));

vi.mock("@/services/free-subscription-sync.service", () => ({
  freeSubscriptionSyncService: {
    renewLocalFreeSubscriptions: syncFreeSubscriptionRenewalMock,
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

vi.mock("@/helpers/chat-room-invitation", () => ({
  expireStalePendingInvitations: (...args: unknown[]) =>
    expireStalePendingInvitationsMock(...args),
}));

vi.mock("@/services/expired-verifications.purge", () => ({
  expiredVerificationsPurgeService: {
    purgeExpiredVerifications: purgeExpiredVerificationsMock,
  },
}));

vi.mock("@/services/task-x402-payment.purge", () => ({
  taskX402PaymentPurgeService: {
    purgeExpiredTaskX402PaymentHeaders: purgeExpiredTaskX402PaymentHeadersMock,
  },
}));

vi.mock("@/services/task-schedule-runs.service", () => ({
  taskScheduleReleaseService: {
    releaseDueSchedules: releaseDueTaskSchedulesMock,
    releaseDueRunAts: releaseDueRunAtsMock,
  },
}));

vi.mock("@/services/project-close-sync.service", () => ({
  projectCloseSyncService: {
    syncProjectCloses: syncProjectClosesMock,
  },
}));

vi.mock("@/services/calendar-invalidation-outbox.service", () => ({
  calendarInvalidationOutboxService: {
    syncInvalidations: syncCalendarInvalidationsMock,
  },
}));

vi.mock("@/services/project-seo-import.service", () => ({
  failSeoAnalysesOfEndedTasks: failSeoAnalysesOfEndedTasksMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((promise: Promise<unknown>) => {
    void promise;
  }),
}));

/**
 * Imported in a hook, not statically and not inside an `it`.
 *
 * Static fails: the router's graph calls the mocked `getEnv` at module scope,
 * and while `vi.mock` is hoisted the consts its factory closes over are not —
 * `ReferenceError: Cannot access 'LOCK_TIMEOUT_MS' before initialization`.
 * Inside the first `it`, the ~1.5s graph load runs against `testTimeout`.
 */
let syncRouter: Hono;

beforeAll(async () => {
  ({ default: syncRouter } = await import("./index"));
});

function createApp() {
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

/** The run's own event, sent when the run ends. */
function runEvent() {
  return coreLogEvents().find(
    (event) =>
      event.operation === "cron_sync" &&
      typeof (event.sync as { outcome?: unknown } | undefined)?.outcome ===
        "string",
  );
}

/** The deadline warning, with the lock and the budget it names. */
function expectDeadlineWarning() {
  const warnings = expectCoreLogWhys(
    "warn",
    "A scheduled sync reached its deadline and was asked to stop",
    [
      "It ran longer than its time budget, LOCK_TIMEOUT minus LOCK_TIMEOUT_BUFFER",
    ],
  );
  onTestFinished(() => {
    expect(warnings[0]?.event).toMatchObject({
      operation: "cron_sync",
      sync: { lockKey: "lock-key", timeoutMs: SYNC_DEADLINE_MS },
      syncRunId: expect.any(String),
    });
  });
  return warnings;
}

/**
 * A sync that threw: an error on the run's event. A content-free route keeps
 * the error as `cause`; any other keeps only the safe fields.
 */
function expectSyncFailure(cause?: string) {
  const errors = expectCoreLogWhys(
    "error",
    "A scheduled sync failed",
    ["The sync threw before it finished"],
    cause === undefined ? undefined : [cause],
  );
  onTestFinished(() => {
    expect(errors[0]?.event).toMatchObject({
      operation: "cron_sync",
      sync: { lockKey: "lock-key", outcome: "failed", lock: "released" },
      failure: { errorName: expect.any(String) },
    });
    if (cause === undefined) expect(errors[0]?.cause).toBeUndefined();
  });
  return errors;
}

/** The `syncRunId` of a drained event. */
function runIdOf(event: Record<string, unknown> | undefined) {
  return event?.syncRunId;
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
    syncCardanoV2RailReadinessMock.mockResolvedValue(false);
    syncX402BuySideReadinessMock.mockResolvedValue(false);
    syncJobsMock.mockResolvedValue({
      processed: 0,
      unfinishedFound: 0,
      durationMs: 0,
    });
    syncSourceImportMock.mockResolvedValue(3);
    syncFreeSubscriptionRenewalMock.mockResolvedValue({
      preCreated: 0,
      renewalErrors: 0,
      renewed: 0,
      stoppedEarly: false,
    });
    syncPolarYearlyGrantsMock.mockResolvedValue({
      errors: 0,
      granted: 0,
      stoppedEarly: false,
    });
    retryOwedPolarRevokesMock.mockResolvedValue({
      errors: 0,
      revoked: 0,
      stoppedEarly: false,
    });
    syncEnterpriseContractRenewalMock.mockResolvedValue({
      catchUpGranted: 0,
      completedContracts: 0,
      expiredPeriods: 0,
      preCreated: 0,
    });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
    );
    expireStalePendingInvitationsMock.mockResolvedValue(0);
    syncStripeCustomersMock.mockResolvedValue(undefined);
    sendFollowUpsMock.mockResolvedValue({
      examined: 0,
      sent: 0,
      reachedEnd: true,
    });
    releaseDueTaskSchedulesMock.mockResolvedValue({ released: 0, ended: 0 });
    releaseDueRunAtsMock.mockResolvedValue({ released: 0, failed: 0 });
    syncProjectClosesMock.mockResolvedValue({
      claimed: 0,
      processedSchedules: 0,
      closed: 0,
      failed: 0,
    });
    syncCalendarInvalidationsMock.mockResolvedValue({
      claimed: 0,
      published: 0,
      failed: 0,
    });
  });

  it("returns 401 for missing cron auth", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents");

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth", async () => {
    const app = createApp();

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
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(409);
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for missing cron auth on jobs sync", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/jobs");

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth on jobs sync", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer invalid",
      },
    });

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when jobs sync lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(409);
    expect(syncJobsMock).not.toHaveBeenCalled();
  });

  it("releases due Task Schedules, then Run ats, then Calendar invalidations, then fails SEO analyses of ended Tasks", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/task-schedules", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    const executionOptions = {
      abortSignal: expect.any(AbortSignal),
      deadlineMs: expect.any(Number),
      shouldContinue: expect.any(Function),
    };
    expect(releaseDueTaskSchedulesMock).toHaveBeenCalledWith(executionOptions);
    expect(releaseDueRunAtsMock).toHaveBeenCalledWith(executionOptions);
    expect(syncCalendarInvalidationsMock).toHaveBeenCalledWith({
      newestFirst: true,
      shouldContinue: expect.any(Function),
    });
    expect(
      releaseDueTaskSchedulesMock.mock.invocationCallOrder[0],
    ).toBeLessThan(releaseDueRunAtsMock.mock.invocationCallOrder[0]);
    expect(releaseDueRunAtsMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncCalendarInvalidationsMock.mock.invocationCallOrder[0],
    );
    expect(
      syncCalendarInvalidationsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(failSeoAnalysesOfEndedTasksMock.mock.invocationCallOrder[0]);
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("runs the leased Project close worker", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/project-closes", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncProjectClosesMock).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      deadlineMs: expect.any(Number),
      shouldContinue: expect.any(Function),
    });
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("mounts the SEO impact tick", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/sync/seo-impact");

    // An unmounted path answers 404; the tick asks for the cron secret.
    expect(response.status).toBe(401);
  });

  it("runs the durable Calendar invalidation publisher", async () => {
    const app = await createApp();

    const response = await app.request(
      "http://localhost/sync/calendar-invalidations",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncCalendarInvalidationsMock).toHaveBeenCalledWith({
      shouldContinue: expect.any(Function),
    });
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("returns 200 and starts registry sync exactly once in background", async () => {
    const deferred = createDeferred();
    syncRegistryAgentsMock.mockImplementation(() => deferred.promise);
    const app = createApp();

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

  it("refreshes the Cardano V2 rail readiness before the registry sync", async () => {
    const deferred = createDeferred();
    syncCardanoV2RailReadinessMock.mockImplementation(() => deferred.promise);
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncCardanoV2RailReadinessMock).toHaveBeenCalledTimes(1);
    // The readiness refresh carries the cron's abort signal, so the sync
    // deadline reaches it. The ceiling it enforces on itself is asserted
    // where it lives, in agent-sync.service.test.ts; this pins only that the
    // signal is handed over at all.
    expect(syncCardanoV2RailReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({
        getCardanoV2RailReadiness: expect.any(Function),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Strictly sequenced: the registry sync only starts once the readiness
    // refresh has finished, so a long replay cannot starve it.
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();

    deferred.resolve();
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the x402 buy-side readiness before the registry sync", async () => {
    const deferred = createDeferred();
    syncX402BuySideReadinessMock.mockImplementation(() => deferred.promise);
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncX402BuySideReadinessMock).toHaveBeenCalledTimes(1);
    // Same treatment as the Cardano readiness: an abort signal so a hung
    // payment node cannot pin the sync lock past its hard timeout.
    expect(syncX402BuySideReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({
        getX402AvailableNetworks: expect.any(Function),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Runs after the Cardano readiness refresh, before the registry replay.
    expect(syncCardanoV2RailReadinessMock).toHaveBeenCalledTimes(1);
    expect(syncRegistryAgentsMock).not.toHaveBeenCalled();

    deferred.resolve();
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("does not reset the registry cursor when only the x402 readiness changed", async () => {
    // The x402 listing reads getX402ReadySources at request time; nothing
    // readiness-dependent is baked into agent rows, so no replay is needed.
    syncX402BuySideReadinessMock.mockResolvedValue(true);
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({ getAgentsDiff: expect.any(Function) }),
      "agents-sync-metadata:dynamic-pricing-v1",
      expect.not.objectContaining({ resetCursor: true }),
    );
  });

  it("still runs the registry sync when x402 readiness throws", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "The x402 buy-side readiness sync failed; the registry sync continues",
      ["The readiness sync threw outside its own failure handling"],
      ["node timeout"],
    );
    // x402 readiness is advisory; the registry sync is this route's primary
    // job. An unhandled throw from the readiness refresh (e.g. its 10s abort
    // firing) must be swallowed so the registry replay still runs.
    syncX402BuySideReadinessMock.mockRejectedValue(new Error("node timeout"));
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledTimes(1);
    // On the run's event, which the registry sync then finishes.
    expect(warnings[0]?.event).toBe(runEvent());
    expect(runEvent()).toMatchObject({
      sync: { lockKey: "lock-key", outcome: "completed" },
    });
  });

  it("does not request a cursor reset on the recurring agents sync", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({ getAgentsDiff: expect.any(Function) }),
      "agents-sync-metadata:dynamic-pricing-v1",
      expect.not.objectContaining({ resetCursor: true }),
    );
  });

  it("requests a cursor reset when the readiness source set changes", async () => {
    syncCardanoV2RailReadinessMock.mockResolvedValue(true);
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncRegistryAgentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({ getAgentsDiff: expect.any(Function) }),
      "agents-sync-metadata:dynamic-pricing-v1",
      expect.objectContaining({ resetCursor: true }),
    );
  });

  it("returns 200 and starts summary sync exactly once in background", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/agents-summary", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("agents-summary-sync");

    await flushMicrotasks();
    expect(syncAgentSummariesMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ network: "mainnet" }),
      expect.objectContaining({ generateAgentSummary: expect.any(Function) }),
      expect.any(Object),
    );
  });

  it("returns 200 and starts enterprise-contract renewal sync exactly once in background", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/enterprise-contracts-renewal",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "enterprise-contracts-renewal-sync",
    );

    await flushMicrotasks();
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(syncEnterpriseContractRenewalMock).toHaveBeenCalledTimes(1);
    expect(prismaTransactionMock.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("returns 200 and starts the CMO yearly grants sync and owed revokes exactly once in background", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/polar-yearly-grants",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith("polar-yearly-grants-sync");

    await flushMicrotasks();
    expect(syncPolarYearlyGrantsMock).toHaveBeenCalledTimes(1);
    expect(syncPolarYearlyGrantsMock).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(retryOwedPolarRevokesMock).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
    );
    // Grants first: revokes failing at Polar cannot take their time.
    expect(syncPolarYearlyGrantsMock.mock.invocationCallOrder[0]).toBeLessThan(
      retryOwedPolarRevokesMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("retries owed revokes even when the CMO yearly grants fail", async () => {
    // Safe fields: Polar's errors can quote customer data.
    expectSyncFailure();
    syncPolarYearlyGrantsMock.mockRejectedValue(new Error("catalog down"));
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/polar-yearly-grants",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(retryOwedPolarRevokesMock).toHaveBeenCalledOnce();
  });

  it("returns 200 and starts free-subscription renewal sync exactly once in background", async () => {
    const app = createApp();

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
    const app = createApp();

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
    const app = createApp();

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

  it("resets the purchase cursor when a jobs replay is requested", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/jobs?replay=true",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resetPurchaseCursor: true,
      }),
    );
  });

  it("leaves the purchase cursor in place on a normal jobs run", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/jobs", {
      headers: {
        Authorization: "Bearer test-cron-secret",
      },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(syncJobsMock.mock.calls[0][0]).not.toHaveProperty(
      "resetPurchaseCursor",
    );
  });

  it("releases source import lock when sync exceeds timeout budget", async () => {
    expectDeadlineWarning();
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

      const app = createApp();
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
      vi.useRealTimers();
    }
  });

  it("releases jobs lock when sync exceeds timeout budget", async () => {
    expectDeadlineWarning();
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

      const app = createApp();
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
      vi.useRealTimers();
    }
  });

  it("returns 200 and starts stripe customer sync exactly once in background", async () => {
    const app = createApp();

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

  it("returns 401 for missing cron auth on guest invitation expiry sync", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
    );

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(expireStalePendingInvitationsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid cron auth on guest invitation expiry sync", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
      {
        headers: {
          Authorization: "Bearer invalid",
        },
      },
    );

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(expireStalePendingInvitationsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when guest invitation expiry lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(409);
    expect(expireStalePendingInvitationsMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts guest invitation expiry sync exactly once in background", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "chat-room-guest-invitations-expire-sync",
    );

    await flushMicrotasks();
    expect(expireStalePendingInvitationsMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for missing cron auth on follow-up notification sync", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/notification-follow-ups",
    );

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(sendFollowUpsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the follow-up notification lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/notification-follow-ups",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(409);
    expect(sendFollowUpsMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts the follow-up notification sync exactly once in background", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/notification-follow-ups",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "notification-follow-ups-sync",
    );

    await flushMicrotasks();
    expect(sendFollowUpsMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The run's own tests pass the abort and the deadline in by hand, so they
   * prove the loop obeys them and never that the route hands over the pair
   * the lock is actually held under. A run given a signal that never fires,
   * or a deadline that always answers yes, pages a backlog on past the lock:
   * the failure the whole arrangement exists to stop. Asserting their shape
   * is not enough, because a fresh AbortController has the right shape.
   */
  it("hands the follow-up run the deadline its lock is held under", async () => {
    expectDeadlineWarning();
    vi.useFakeTimers();

    try {
      // Held open, so the handler is still inside the operation when the
      // deadline lands. A run that returned first would clear the timeout
      // and the signal would never fire.
      let finishRun: ((result: unknown) => void) | undefined;
      sendFollowUpsMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRun = resolve;
          }),
      );

      const app = createApp();
      const response = await app.request(
        "http://localhost/sync/notification-follow-ups",
        { headers: { Authorization: "Bearer test-cron-secret" } },
      );

      expect(response.status).toBe(200);
      await vi.advanceTimersByTimeAsync(0);

      const options = sendFollowUpsMock.mock.calls[0]?.[0];
      // Exactly these two, which is all this pins. A third option would be
      // one the run was never meant to get from here, and `now` is the one
      // that would move the window rather than add to it.
      expect(Object.keys(options).sort()).toEqual([
        "abortSignal",
        "shouldContinue",
      ]);
      expect(options.abortSignal.aborted).toBe(false);
      expect(options.shouldContinue()).toBe(true);

      // A millisecond short of it first. Without this the test passes for any
      // deadline at all between nothing and the real one, and the arithmetic
      // that produces it is decoration.
      await vi.advanceTimersByTimeAsync(SYNC_DEADLINE_MS - 1);

      expect(options.abortSignal.aborted).toBe(false);
      expect(options.shouldContinue()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);

      expect(options.abortSignal.aborted).toBe(true);
      // Both, because they are two separate options and the route can get
      // one of them right. Nothing else here ever sees this answer false,
      // so without this line a deadline that always says yes passes.
      expect(options.shouldContinue()).toBe(false);

      finishRun?.({ examined: 0, sent: 0, reachedEnd: false });
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 401 for missing cron auth on x402 header purge sync", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/task-x402-payment-headers-purge",
    );

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(purgeExpiredTaskX402PaymentHeadersMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the x402 header purge lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/task-x402-payment-headers-purge",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(409);
    expect(purgeExpiredTaskX402PaymentHeadersMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts the x402 header purge exactly once in background", async () => {
    purgeExpiredTaskX402PaymentHeadersMock.mockResolvedValue({ purged: 2 });
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/task-x402-payment-headers-purge",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "task-x402-payment-headers-purge-sync",
    );

    await flushMicrotasks();
    expect(purgeExpiredTaskX402PaymentHeadersMock).toHaveBeenCalledTimes(1);
    expect(purgeExpiredTaskX402PaymentHeadersMock).toHaveBeenCalledWith(
      networkClients.mainnet,
      { abortSignal: expect.any(AbortSignal) },
    );
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("returns 401 for missing cron auth on expired verification purge sync", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/expired-verifications-purge",
    );

    expect(response.status).toBe(401);
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(purgeExpiredVerificationsMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the expired verification purge lock is already held", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/expired-verifications-purge",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(409);
    expect(purgeExpiredVerificationsMock).not.toHaveBeenCalled();
  });

  it("returns 200 and starts the expired verification purge exactly once in background", async () => {
    purgeExpiredVerificationsMock.mockResolvedValue({ purged: 4 });
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/expired-verifications-purge",
      { headers: { Authorization: "Bearer test-cron-secret" } },
    );

    expect(response.status).toBe(200);
    expect(acquireLockMock).toHaveBeenCalledWith(
      "expired-verifications-purge-sync",
    );

    await flushMicrotasks();
    expect(purgeExpiredVerificationsMock).toHaveBeenCalledTimes(1);
    expect(purgeExpiredVerificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("releases guest invitation expiry lock after completion", async () => {
    expireStalePendingInvitationsMock.mockResolvedValue(3);
    const app = createApp();

    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(expireStalePendingInvitationsMock).toHaveBeenCalledTimes(1);
    expect(expireStalePendingInvitationsMock).toHaveBeenCalledWith(prisma, {
      now: expect.any(Date),
    });
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
  });

  it("does not release guest invitation expiry lock when sync ignores cancellation", async () => {
    expectDeadlineWarning();
    vi.useFakeTimers();

    try {
      expireStalePendingInvitationsMock.mockImplementation(
        () =>
          new Promise<number>(() => {
            // Intentionally never resolves.
          }),
      );

      const app = createApp();
      const response = await app.request(
        "http://localhost/sync/chat-room-guest-invitations-expire",
        {
          headers: {
            Authorization: "Bearer test-cron-secret",
          },
        },
      );

      expect(response.status).toBe(200);
      await flushPromises();
      expect(expireStalePendingInvitationsMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(4000);
      await flushPromises();

      expect(releaseLockMock).not.toHaveBeenCalled();
    } finally {
      // The sync never settles by design; leave nothing for the drain to await.
      vi.mocked(waitUntil).mockClear();
      vi.useRealTimers();
    }
  });

  it("warns when guest invitation expiry lock ownership changed on release", async () => {
    expireStalePendingInvitationsMock.mockResolvedValue(1);
    releaseLockMock.mockResolvedValue(false);
    const warnings = expectCoreLogWhys(
      "warn",
      "A scheduled sync's lock was not released",
      [
        "Another run owns the lock now: it expired while this run was still going",
      ],
    );

    const app = createApp();
    const response = await app.request(
      "http://localhost/sync/chat-room-guest-invitations-expire",
      {
        headers: {
          Authorization: "Bearer test-cron-secret",
        },
      },
    );

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(releaseLockMock).toHaveBeenCalledWith("lock-key", "owner-token");
    expect(warnings[0]?.event).toMatchObject({
      operation: "cron_sync",
      sync: {
        lockKey: "lock-key",
        outcome: "completed",
        lock: "ownership_changed",
      },
    });
  });

  it("does not release lock when a long-running sync ignores cancellation", async () => {
    expectDeadlineWarning();
    vi.useFakeTimers();

    try {
      syncRegistryAgentsMock.mockImplementation(
        () =>
          new Promise<void>(() => {
            // Intentionally never resolves.
          }),
      );

      const app = createApp();
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
      // The sync never settles by design; leave nothing for the drain to await.
      vi.mocked(waitUntil).mockClear();
      vi.useRealTimers();
    }
  });

  it("releases lock when a long-running sync cooperatively cancels", async () => {
    const deadline = expectDeadlineWarning();
    vi.useFakeTimers();

    try {
      syncRegistryAgentsMock.mockImplementation(
        (
          _scope: unknown,
          _client: unknown,
          _metadataKey: string,
          options: { abortSignal: AbortSignal },
        ) =>
          new Promise<void>((resolve) => {
            options.abortSignal.addEventListener("abort", () => {
              resolve();
            });
          }),
      );

      const app = createApp();
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
      // The run event follows the release.
      await flushPromises();
      expect(runEvent()).toMatchObject({
        sync: { outcome: "cancelled", lock: "released" },
      });
      expect(runIdOf(deadline[0]?.event)).toEqual(runIdOf(runEvent()));
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears background timers when sync fails", async () => {
    vi.useFakeTimers();
    expectSyncFailure();

    try {
      syncRegistryAgentsMock.mockRejectedValue(new Error("sync failed fast"));

      const app = createApp();
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
      vi.useRealTimers();
    }
  });

  it("sends one run event with the outcome, the lock and the sync's counts", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/sync/source-import", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    expect(response.status).toBe(200);
    await flushMicrotasks();
    expect(coreLogEvents()).toHaveLength(1);
    expect(runEvent()).toMatchObject({
      level: "info",
      operation: "cron_sync",
      sync: {
        lockKey: "lock-key",
        outcome: "completed",
        lock: "released",
        durationMs: expect.any(Number),
      },
      syncRunId: expect.any(String),
      result: { pendingBlobs: 3 },
    });
  });

  it("ties a service's event during the run to that run", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "A source import item was skipped",
      ["The example item failed"],
    );
    syncSourceImportMock.mockImplementation(async () => {
      recordCoreWarning(
        { operation: "source_import_item" },
        {
          message: "A source import item was skipped",
          why: "The example item failed",
        },
      );
      return 1;
    });
    const app = createApp();

    await app.request("http://localhost/sync/source-import", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    await flushMicrotasks();
    expect(runIdOf(warnings[0]?.event)).toEqual(expect.any(String));
    expect(runIdOf(warnings[0]?.event)).toEqual(runIdOf(runEvent()));
  });

  it("puts each part of a multi-step sync on the same run event", async () => {
    const app = createApp();

    await app.request("http://localhost/sync/polar-yearly-grants", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    await flushMicrotasks();
    expect(coreLogEvents()).toHaveLength(1);
    expect(runEvent()).toMatchObject({
      result: {
        grants: { errors: 0, granted: 0, stoppedEarly: false },
        revokes: { errors: 0, revoked: 0, stoppedEarly: false },
      },
    });
  });

  it.each([
    ["skill-catalog", () => refreshSkillCatalogMock],
    ["agents", () => syncRegistryAgentsMock],
  ])(
    "keeps a Prisma validation error's quoted text off the %s run event",
    async (route, mock) => {
      const errors = expectSyncFailure();
      mock().mockRejectedValue(prismaValidationError());
      const app = createApp();

      await app.request(`http://localhost/sync/${route}`, {
        headers: { Authorization: "Bearer test-cron-secret" },
      });

      await flushMicrotasks();
      expect(errors[0]?.event).toMatchObject({
        failure: { errorName: "PrismaClientValidationError" },
      });
      const drained = JSON.stringify(coreLogEvents());
      expect(drained).not.toContain("PRIVATE-SENTINEL");
      expect(drained).not.toContain("sk_live_abc123");
    },
  );

  it("keeps a content-bearing sync's error text and secrets off its event", async () => {
    // A job's state carries what its agent returned.
    const errors = expectSyncFailure();
    syncJobsMock.mockRejectedValue(
      new Error(
        "Reply to alice@example.com: our private plan, key sk_live_abc123",
      ),
    );
    const app = createApp();

    await app.request("http://localhost/sync/jobs", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    await flushMicrotasks();
    const drained = JSON.stringify(coreLogEvents());
    expect(errors).toHaveLength(1);
    expect(drained).not.toContain("private plan");
    expect(drained).not.toContain("alice@example.com");
    expect(drained).not.toContain("sk_live_abc123");
  });

  it("keeps a content-free sync's error as the cause on its event", async () => {
    expectSyncFailure("connection to the database was lost");
    purgeExpiredVerificationsMock.mockRejectedValue(
      new Error("connection to the database was lost"),
    );
    const app = createApp();

    await app.request("http://localhost/sync/expired-verifications-purge", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    await flushMicrotasks();
  });

  it("ties each overlapping run's events to that run", async () => {
    const releaseError = expectCoreLogWhys(
      "error",
      "Could not release a scheduled sync's lock",
      ["The database update that frees the lock failed"],
      ["db down"],
    );
    let finishFirst: (count: number) => void = () => {};
    syncSourceImportMock
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(5);
    releaseLockMock
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("db down"));
    const app = createApp();
    const request = () =>
      app.request("http://localhost/sync/source-import", {
        headers: { Authorization: "Bearer test-cron-secret" },
      });

    // The second run starts and ends while the first is still going.
    await request();
    await flushMicrotasks();
    await request();
    await flushMicrotasks();
    finishFirst(1);
    await flushMicrotasks();

    const runs = coreLogEvents().filter(
      (event) => runIdOf(event) && "result" in event,
    );
    expect(runs.map((event) => event.result)).toEqual([
      { pendingBlobs: 5 },
      { pendingBlobs: 1 },
    ]);
    const [second, first] = runs;
    expect(runIdOf(first)).not.toEqual(runIdOf(second));
    expect(second).toMatchObject({ sync: { lock: "released" } });
    expect(first).toMatchObject({ sync: { lock: "release_failed" } });
    expect(runIdOf(releaseError[0]?.event)).toEqual(runIdOf(first));
  });

  it("logs a lock release that throws as its own error and marks the run", async () => {
    expectCoreLogWhys(
      "error",
      "Could not release a scheduled sync's lock",
      ["The database update that frees the lock failed"],
      ["db down"],
    );
    releaseLockMock.mockRejectedValue(new Error("db down"));
    const app = createApp();

    await app.request("http://localhost/sync/source-import", {
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    await flushMicrotasks();
    expect(coreLogEvents()).toHaveLength(2);
    expect(runEvent()).toMatchObject({
      level: "info",
      sync: {
        lockKey: "lock-key",
        outcome: "completed",
        lock: "release_failed",
      },
    });
  });
});
