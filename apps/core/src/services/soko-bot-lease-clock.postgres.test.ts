/**
 * Turn ownership against a disposable PostgreSQL database while the
 * application clock runs ahead of or behind PostgreSQL. Lease, heartbeat,
 * deadline and cutoff times come from PostgreSQL, so a host's skew cannot
 * change a decision about a turn: the recovery claim, the watchdog's stale
 * claim, runtime and sandbox authorization, CMO's stall check and the daily
 * cap decide the same way at any skew, and the stamps writers leave are
 * PostgreSQL time. A first start's heartbeat younger than 45 s makes a
 * duplicate's drain step back, and no recovery path takes over on it.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-lease-clock.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  type RuntimeEvent,
  SOKO_BOT_TURN_TOKEN_HEADER,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { streamStoredEvents } from "@/lib/soko-bot/in-process-runtime";
import { SokoBotReconciliationLeaseLostError } from "@/lib/soko-bot/reconciliation-lease";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import {
  announceTurn,
  closeTurn,
  RuntimeEventLog,
  runtimeEvent,
} from "@/lib/soko-bot/turn-loop";
import sokoBotRuntimeRoutes from "@/routes/v1/soko-bot-runtime";
import mountStartTurn, { mountById } from "@/routes/v1/soko-bots/me/turns/post";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

const { pending } = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));

vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

import {
  SokoBotControlPlane,
  SokoBotStartAbortedError,
  sokoBotControlPlane,
} from "./soko-bot-control-plane.service";
import { proactiveGate } from "./soko-bot-proactive.service";
import { requireMutationAuthority } from "./soko-bot-runtime/authorization";
import { sokoBotRuntimeService } from "./soko-bot-runtime.service";
import {
  settledTurnStatus,
  TURN_ROW_SELECT,
} from "./soko-bot-turn-progress.service";
import { sokoBotTurnsSyncService } from "./soko-bot-turns-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const MINUTE = 60 * 1_000;
const LEASE = "lease_clock";

const unusedRuntime: SokoBotRuntime = {
  createSession: async () => {
    throw new Error("not used");
  },
  streamEvents: () => {
    throw new Error("not used");
  },
  cancelTurn: async () => undefined,
  resetSession: async () => undefined,
  inspectSession: async () => ({
    healthy: true,
    runtimeVersion: "test",
    sessionStatus: "waiting",
  }),
};

/** Within a few seconds of `expected`: the time a write took. */
function expectNear(actual: Date | null, expected: number) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as Date).getTime() - expected)).toBeLessThan(10_000);
}

/** Every later `Date` in this process reads `skewMs` ahead of PostgreSQL. */
async function skewApplicationClock(skewMs: number): Promise<Date> {
  const now = await databaseNow();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now.getTime() + skewMs);
  return now;
}

async function tickWithBusyPool(tick: () => void) {
  const query = vi.spyOn(Pool.prototype, "query");
  const pool = await databaseNow().then(() => query.mock.contexts.at(-1));
  query.mockRestore();
  if (!(pool instanceof Pool) || !pool.options.max) {
    throw new Error("Core did not use a pg pool with a connection limit");
  }

  const connections = await Promise.all(
    Array.from({ length: pool.options.max }, () => pool.connect()),
  );
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const renewal = Promise.resolve(tick());
  try {
    await vi.waitFor(() => expect(pool.waitingCount).toBe(1));
    // Advance past Prisma's interactive transaction connection limit.
    await vi.advanceTimersByTimeAsync(2_001);
  } finally {
    for (const connection of connections) connection.release();
    vi.useRealTimers();
    await renewal;
  }
}

describe.skipIf(!enabled)("turn ownership under application clock skew", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Clock owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    botId = (
      await prisma.sokoBot.create({
        data: {
          userId,
          workspaceId,
          ingestTimezone: "UTC",
          proactiveDailyLimit: 1,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await Promise.all(pending.splice(0));
    vi.useRealTimers();
    vi.restoreAllMocks();
    // The cascade from the user takes its workspace, bot and turns.
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A turn whose times are PostgreSQL time plus the given offsets. */
  async function createTurn(
    now: Date,
    turn: {
      status: "STARTING" | "RUNNING";
      eveSessionId: string | null;
      createdAgoMs?: number;
      heartbeatAgoMs?: number;
      leaseInMs: number;
      deadlineInMs?: number;
      source?: "CHAT" | "SCHEDULE";
      errorKind?: string | null;
    },
  ): Promise<string> {
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    const created = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source: turn.source ?? "CHAT",
        status: turn.status,
        clientTurnId: randomUUID(),
        userMessage: "Clock turn",
        capabilityNames: [],
        eveSessionId: turn.eveSessionId,
        leaseToken: LEASE,
        leaseExpiresAt: at(turn.leaseInMs),
        ...(turn.errorKind !== undefined ? { errorKind: turn.errorKind } : {}),
        reconcilerHeartbeatAt:
          turn.heartbeatAgoMs === undefined ? null : at(-turn.heartbeatAgoMs),
        deadlineAt: at(turn.deadlineInMs ?? 60 * MINUTE),
        createdAt: at(-(turn.createdAgoMs ?? 0)),
      },
      select: { id: true },
    });
    return created.id;
  }

  async function leaseOf(turnId: string): Promise<string | null> {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
      select: { leaseToken: true },
    });
    return turn.leaseToken;
  }

  function syncTurns() {
    return sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: [botId],
    });
  }

  async function fundStart() {
    const grant = await prisma.transaction.create({
      data: { userId, amount: 100_000n * 10_000_000_000n },
    });
    await prisma.creditBucket.create({
      data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
    });
  }

  function startInput() {
    return {
      userId,
      workspaceId,
      clientTurnId: randomUUID(),
      message: "What is on my board?",
      source: "CHAT",
      presetRoute: { route: "DELEGATE_TASK", reason: "fixture" },
    } as const;
  }

  function acceptedSession(sessionId = "session_started") {
    return {
      sessionId,
      runtimeVersion: "test",
      acceptedAt: new Date().toISOString(),
    };
  }

  it("leaves a start created just now to its starter when the host runs 5 minutes ahead", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "STARTING",
      eveSessionId: null,
      leaseInMs: 16 * MINUTE,
    });
    await skewApplicationClock(5 * MINUTE);

    const recovered = await new SokoBotControlPlane(
      unusedRuntime,
    ).recoverStartingTurn(turnId);

    expect(recovered).toBeNull();
    expect(await leaseOf(turnId)).toBe(LEASE);
  });

  it("claims a start abandoned 3 minutes ago when the host runs 5 minutes behind", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "STARTING",
      eveSessionId: null,
      createdAgoMs: 3 * MINUTE,
      leaseInMs: 13 * MINUTE,
    });
    await skewApplicationClock(-5 * MINUTE);

    // The fixture has no context snapshot, so the claimed replay stops there.
    await expect(
      new SokoBotControlPlane(unusedRuntime).recoverStartingTurn(turnId),
    ).rejects.toThrow("Ambiguous Soko Bot start is not ready for replay");

    expect(await leaseOf(turnId)).not.toBe(LEASE);
    const claimed = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(claimed.leaseExpiresAt).toBeNull();
    expect(claimed.reconcilerHeartbeatAt).toBeNull();
  });

  it("G8: settles a start in the same watchdog tick that recovers it", async () => {
    await fundStart();
    const runtime = getSokoBotRuntime();
    const createSession = vi.spyOn(runtime, "createSession");
    createSession.mockRejectedValue(
      new DOMException("Acceptance response lost", "TimeoutError"),
    );
    await expect(sokoBotControlPlane.startTurn(startInput())).rejects.toThrow(
      "Acceptance response lost",
    );
    const turn = await prisma.sokoBotTurn.findFirstOrThrow({
      where: { sokoBotId: botId },
    });
    createSession.mockResolvedValue(acceptedSession());
    vi.spyOn(runtime, "streamEvents").mockImplementation(async function* () {
      const at = new Date().toISOString();
      const events: Omit<RuntimeEvent, "meta">[] = [
        { type: "turn.started", data: { turnId: turn.id } },
        { type: "message.received", data: { message: turn.userMessage } },
        { type: "turn.completed", data: { turnId: turn.id } },
        { type: "session.waiting", data: {} },
      ];
      for (const [startIndex, event] of events.entries()) {
        yield {
          startIndex,
          event: { ...event, meta: { at, id: randomUUID() } },
        };
      }
    });

    expect(await syncTurns()).toMatchObject({ claimed: 1, reconciled: 1 });
    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turn.id } }),
    ).toMatchObject({ status: "COMPLETED", leaseToken: null });
  });

  async function runningTurnWithAbandonedDrain() {
    const sessionId = "session_long_turn";
    const turnId = await createTurn(await databaseNow(), {
      status: "RUNNING",
      eveSessionId: sessionId,
      heartbeatAgoMs: MINUTE,
      leaseInMs: 15 * MINUTE,
    });
    vi.spyOn(getSokoBotRuntime(), "streamEvents").mockImplementation(
      streamStoredEvents,
    );
    return new RuntimeEventLog(turnId, sessionId);
  }

  async function closeCompletedRuntime(log: RuntimeEventLog) {
    await log.append(runtimeEvent("message.completed", { message: "Done." }));
    await log.append(runtimeEvent("turn.completed", { turnId: log.turnId }));
    await closeTurn(log, LEASE);
  }

  it("close after a watchdog stale-drain claim settles at close", async () => {
    const log = await runningTurnWithAbandonedDrain();
    expect(await syncTurns()).toMatchObject({ claimed: 1, reconciled: 1 });
    expect(await leaseOf(log.turnId)).not.toBe(LEASE);

    await announceTurn(log, "Clock turn");
    await closeCompletedRuntime(log);

    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: log.turnId } }),
    ).toMatchObject({
      status: "COMPLETED",
      finalAnswer: "Done.",
      leaseToken: null,
    });
  });

  it("a live watchdog drain sees completion appended after its first snapshot", async () => {
    const log = await runningTurnWithAbandonedDrain();
    await announceTurn(log, "Clock turn");
    const snapshotRead = Promise.withResolvers<void>();
    const returnSnapshot = Promise.withResolvers<void>();
    vi.spyOn(getSokoBotRuntime(), "streamEvents").mockImplementation(
      async function* (input) {
        for await (const event of streamStoredEvents(input)) {
          if (event.event.type === "session.started") {
            snapshotRead.resolve();
            await returnSnapshot.promise;
          }
          yield event;
        }
      },
    );
    const syncing = syncTurns();
    void syncing.then(() => snapshotRead.resolve(), snapshotRead.reject);
    try {
      await snapshotRead.promise;
      const watchdogLease = await leaseOf(log.turnId);
      expect(watchdogLease).not.toBe(LEASE);
      await closeCompletedRuntime(log);
      expect(await leaseOf(log.turnId)).toBe(watchdogLease);
    } finally {
      returnSnapshot.resolve();
      expect(await syncing).toMatchObject({ claimed: 1, reconciled: 1 });
    }
    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: log.turnId } }),
    ).toMatchObject({
      status: "COMPLETED",
      finalAnswer: "Done.",
      leaseToken: null,
    });
  });

  it("G5a: fences a stale drain while the admin reset is in the runtime", async () => {
    const sessionId = "session_reset";
    const turnId = await createTurn(await databaseNow(), {
      status: "RUNNING",
      eveSessionId: sessionId,
      heartbeatAgoMs: MINUTE,
      leaseInMs: 15 * MINUTE,
    });
    await prisma.sokoBot.update({
      where: { id: botId },
      data: { status: "RUNNING", eveSessionId: sessionId },
    });
    const reconcile = vi
      .spyOn(sokoBotControlPlane, "reconcileTurn")
      .mockResolvedValue(undefined);
    const control = new SokoBotControlPlane({
      ...unusedRuntime,
      resetSession: async () => {
        await expect(
          control.reconcileTurn(turnId, undefined, LEASE),
        ).rejects.toBeInstanceOf(SokoBotReconciliationLeaseLostError);
        expect(await syncTurns()).toMatchObject({ claimed: 0 });
        expect(reconcile).not.toHaveBeenCalled();
      },
    });

    await control.performAdminAction({
      sokoBotId: botId,
      operatorId: userId,
      action: "RESET_SESSION",
      reason: "Clear failed session",
    });

    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }),
    ).toMatchObject({ status: "CANCELLED", errorKind: "session_reset" });
  });

  it("G5a: leaves the reset intent pending when settlement loses its lease", async () => {
    const sessionId = "session_reset_lost";
    const turnId = await createTurn(await databaseNow(), {
      status: "RUNNING",
      eveSessionId: sessionId,
      leaseInMs: 15 * MINUTE,
    });
    await prisma.sokoBot.update({
      where: { id: botId },
      data: { status: "RUNNING", eveSessionId: sessionId },
    });
    const successorToken = randomUUID();
    const operationId = randomUUID();
    const control = new SokoBotControlPlane({
      ...unusedRuntime,
      resetSession: async () => {
        await prisma.sokoBotTurn.update({
          where: { id: turnId },
          data: { leaseToken: successorToken },
        });
      },
    });

    await expect(
      control.performAdminAction({
        sokoBotId: botId,
        operatorId: userId,
        action: "RESET_SESSION",
        reason: "Clear failed session",
        operationId,
      }),
    ).rejects.toThrow(/lease/);
    expect(
      await prisma.sokoBotAdminAction.findMany({
        where: { operationId },
        select: { status: true },
      }),
    ).toEqual([{ status: "ATTEMPTED" }]);
    expect(await leaseOf(turnId)).toBe(successorToken);
  });

  it("does not take a drain whose heartbeat is fresh when the host runs a minute ahead", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "RUNNING",
      eveSessionId: "session_clock",
      heartbeatAgoMs: 0,
      leaseInMs: 16 * MINUTE,
    });
    const reconcile = vi
      .spyOn(sokoBotControlPlane, "reconcileTurn")
      .mockResolvedValue(undefined);
    await skewApplicationClock(MINUTE);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: [botId],
    });

    expect(result.claimed).toBe(0);
    expect(reconcile).not.toHaveBeenCalled();
    expect(await leaseOf(turnId)).toBe(LEASE);
  });

  it("takes a drain whose heartbeat is a minute old when the host runs a minute behind", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "RUNNING",
      eveSessionId: "session_clock",
      heartbeatAgoMs: MINUTE,
      leaseInMs: 15 * MINUTE,
    });
    const reconcile = vi
      .spyOn(sokoBotControlPlane, "reconcileTurn")
      .mockResolvedValue(undefined);
    await skewApplicationClock(-MINUTE);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: [botId],
    });

    expect(result.claimed).toBe(1);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(await leaseOf(turnId)).not.toBe(LEASE);
    const claimed = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expectNear(claimed.reconcilerHeartbeatAt, now.getTime());
    expectNear(claimed.leaseExpiresAt, now.getTime() + 16 * MINUTE);
  });

  it("stamps a started turn with PostgreSQL time when the host runs 5 minutes ahead", async () => {
    await fundStart();
    vi.spyOn(getSokoBotRuntime(), "createSession").mockImplementation(
      async () => acceptedSession(),
    );
    const now = await skewApplicationClock(5 * MINUTE);

    const started = await sokoBotControlPlane.startTurn(startInput());

    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: started.turnId },
    });
    expect(turn.status).toBe("RUNNING");
    expectNear(turn.createdAt, now.getTime());
    expectNear(turn.reconcilerHeartbeatAt, now.getTime());
    expectNear(turn.leaseExpiresAt, now.getTime() + 16 * MINUTE);
    // A preset route is not a person asking: the 15-minute deadline.
    expectNear(turn.deadlineAt, now.getTime() + 15 * MINUTE);
  });

  it.each([
    { kind: "a released ambiguous", errorKind: "runtime_start_ambiguous" },
    { kind: "an abandoned", errorKind: null },
  ])(
    "G1: a POST duplicate observes a live recovery of $kind start",
    async ({ errorKind }) => {
      await fundStart();
      const input = startInput();
      const createSession = vi.spyOn(getSokoBotRuntime(), "createSession");
      createSession.mockRejectedValue(
        new DOMException("Acceptance response lost", "TimeoutError"),
      );
      await expect(sokoBotControlPlane.startTurn(input)).rejects.toThrow(
        "Acceptance response lost",
      );
      const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: {
          sokoBotId_clientTurnId: {
            sokoBotId: botId,
            clientTurnId: input.clientTurnId,
          },
        },
      });
      if (errorKind === null) {
        await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: {
            errorKind,
            reconcilerHeartbeatAt: new Date(
              (await databaseNow()).getTime() - MINUTE,
            ),
            leaseExpiresAt: turn.deadlineAt,
          },
        });
      }
      createSession.mockClear();
      const dispatch = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      createSession
        .mockImplementationOnce(async () => {
          dispatch.resolve();
          await finish.promise;
          return acceptedSession();
        })
        .mockResolvedValue(acceptedSession("unexpected_competing_session"));
      const recovery = errorKind
        ? sokoBotControlPlane.startTurn(input)
        : sokoBotControlPlane.recoverStartingTurn(turn.id);
      recovery.catch(dispatch.reject);
      try {
        await dispatch.promise;
        const app = new OpenAPIHonoWithAuth();
        app.use("*", async (c, next) => {
          c.set("authContext", {
            actor: "user",
            userId,
            organizationId: null,
            role: "user",
          });
          c.set("workspaceContext", {
            workspaceId,
            userId,
            organizationId: null,
          });
          await next();
        });
        app.onError(errorHandler);
        mountStartTurn(app);
        mountById(app);
        const response = await app.request(
          errorKind ? "/me/turns" : `/${botId}/turns`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clientTurnId: input.clientTurnId,
              message: input.message,
            }),
          },
        );
        await Promise.all(pending);

        expect(response.status).toBe(201);
        expect(createSession).toHaveBeenCalledOnce();
        expect(pending).toHaveLength(0);
        expect(coreLogEvents()).toContainEqual(
          expect.objectContaining({
            level: "info",
            operation: "soko_bot_turn_start",
            turn: { id: turn.id },
            outcome: "observed_duplicate",
          }),
        );
        await expect(
          sokoBotControlPlane.reconcileTurn(
            turn.id,
            undefined,
            turn.leaseToken ?? LEASE,
          ),
        ).rejects.toBeInstanceOf(SokoBotReconciliationLeaseLostError);
      } finally {
        finish.resolve();
        await recovery;
      }
      await expect(recovery).resolves.toMatchObject({
        turnId: turn.id,
        duplicate: true,
        status: "RUNNING",
        reconciliationLeaseToken: expect.any(String),
      });
    },
  );

  it.each([
    { path: "fresh", proofFails: false, status: "CANCELLED" },
    { path: "recovered", proofFails: false, status: "STARTING" },
    { path: "fresh", proofFails: true, status: "CANCELLED" },
    { path: "fresh", proofFails: true, status: "CANCEL_REQUESTED" },
    { path: "recovered", proofFails: true, status: "STARTING" },
  ])(
    "G12: $path acknowledgement rollback leaves $status (proof query fails: $proofFails)",
    async ({ path, proofFails, status }) => {
      await fundStart();
      const input = startInput();
      const createSession = vi.fn<SokoBotRuntime["createSession"]>();
      const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
      const cancellationPending = status === "CANCEL_REQUESTED";
      if (cancellationPending) {
        resetSession.mockRejectedValue(new Error("Runtime reset unavailable"));
        expectCoreLog(
          "warn",
          "Could not reset the runtime session of a turn whose start was not acknowledged",
        );
      }
      const control = new SokoBotControlPlane({
        ...unusedRuntime,
        createSession,
        resetSession,
      });
      if (path === "recovered") {
        createSession.mockRejectedValue(
          new DOMException("Acceptance response lost", "TimeoutError"),
        );
        await expect(control.startTurn(input)).rejects.toThrow(
          "Acceptance response lost",
        );
      }
      const session = acceptedSession();
      createSession.mockImplementation(async ({ turnId }) => {
        await sokoBotRuntimeService.authorize({
          turnId,
          sessionId: session.sessionId,
        });
        await prisma.sokoBot.update({
          where: { id: botId },
          data: { status: "PAUSED" },
        });
        if (cancellationPending) await control.cancelTurn(userId, turnId);
        if (proofFails) {
          vi.spyOn(prisma.sokoBotTurn, "updateMany").mockRejectedValueOnce(
            new Error("Acknowledgement proof query failed"),
          );
        }
        return session;
      });

      const [outcome] = await Promise.allSettled([control.startTurn(input)]);
      const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: {
          sokoBotId_clientTurnId: {
            sokoBotId: botId,
            clientTurnId: input.clientTurnId,
          },
        },
      });
      expect({ outcome, turn }).toMatchObject({
        outcome: {
          status: "rejected",
          reason: expect.any(SokoBotStartAbortedError),
        },
        turn: {
          status,
          errorKind:
            path === "fresh" ? "start_aborted" : "runtime_start_ambiguous",
          eveSessionId: path === "fresh" ? session.sessionId : null,
          leaseExpiresAt: cancellationPending ? expect.any(Date) : null,
          startedAt: null,
          ...(status !== "CANCELLED" && { reconcilerHeartbeatAt: null }),
        },
      });
      expect(outcome).toMatchObject({
        reason: {
          message: expect.stringContaining(
            path === "fresh"
              ? "before runtime acknowledgement"
              : "before replay acknowledgement",
          ),
        },
      });
      expect(resetSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: session.sessionId }),
      );
    },
  );

  it.each([
    { path: "fresh", replaying: false, status: "RUNNING" },
    { path: "replay", replaying: true, status: "CANCEL_REQUESTED" },
  ] as const)(
    "grants the $path starter a drain when only the acknowledgement response is lost ($status)",
    async ({ replaying, status }) => {
      await fundStart();
      const input = startInput();
      const createSession = vi.fn<SokoBotRuntime["createSession"]>();
      const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
      const control = new SokoBotControlPlane({
        ...unusedRuntime,
        createSession,
        resetSession,
      });
      if (replaying) {
        createSession.mockRejectedValue(
          new DOMException("Acceptance response lost", "TimeoutError"),
        );
        await expect(control.startTurn(input)).rejects.toThrow(
          "Acceptance response lost",
        );
      }
      const transaction = prisma.$transaction.bind(prisma);
      const session = acceptedSession();
      let heartbeatBeforeProof: Date | undefined;
      createSession.mockImplementationOnce(async ({ turnId }) => {
        vi.spyOn(prisma, "$transaction").mockImplementationOnce(
          async (callback, options) => {
            await transaction(callback, options);
            const now = await databaseNow();
            heartbeatBeforeProof = new Date(now.getTime() - MINUTE);
            await prisma.sokoBotTurn.update({
              where: { id: turnId },
              data: {
                status,
                cancellationRequestedAt:
                  status === "CANCEL_REQUESTED" ? now : null,
                reconcilerHeartbeatAt: heartbeatBeforeProof,
              },
            });
            throw new Error("Connection reset after commit");
          },
        );
        return session;
      });

      const result = await control.startTurn(input);
      const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: result.turnId },
      });
      expect(heartbeatBeforeProof).toBeDefined();
      expect(turn).toMatchObject({
        status,
        startedAt: new Date(session.acceptedAt),
        eveSessionId: session.sessionId,
        leaseToken: expect.any(String),
      });
      expect(result).toMatchObject({
        duplicate: replaying,
        status: "RUNNING",
        sessionId: session.sessionId,
        reconciliationLeaseToken: turn.leaseToken,
      });
      expect(turn.reconcilerHeartbeatAt?.getTime()).toBeGreaterThan(
        heartbeatBeforeProof?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      expect(resetSession).not.toHaveBeenCalled();
      expect(coreLogEvents()).not.toContainEqual(
        expect.objectContaining({
          turn: { id: turn.id },
          outcome: "observed_duplicate",
        }),
      );
    },
  );

  it.each([
    {
      scenario: "fresh start",
      replaying: false,
      earlyAttach: false,
    },
    {
      scenario: "early session attach",
      replaying: false,
      earlyAttach: true,
    },
    {
      scenario: "G3 duplicate during live recovery",
      replaying: true,
      earlyAttach: false,
    },
    {
      scenario: "busy pool",
      replaying: false,
      earlyAttach: false,
      poolBusy: true,
    },
  ])(
    "keeps a blocked starter's lease across watchdog scans and retries ($scenario)",
    async ({ replaying, earlyAttach, poolBusy }) => {
      await fundStart();
      const control = sokoBotControlPlane;
      const input = startInput();
      const createSession = vi.spyOn(getSokoBotRuntime(), "createSession");
      let releasedId: string | undefined;
      if (replaying) {
        createSession.mockRejectedValue(
          new DOMException("Acceptance response lost", "TimeoutError"),
        );
        await expect(control.startTurn(input)).rejects.toThrow(
          "Acceptance response lost",
        );
        const released = await prisma.sokoBotTurn.findUniqueOrThrow({
          where: {
            sokoBotId_clientTurnId: {
              sokoBotId: botId,
              clientTurnId: input.clientTurnId,
            },
          },
        });
        releasedId = released.id;
        // A legacy starter would only allow recovery after this age.
        await prisma.sokoBotTurn.update({
          where: { id: released.id },
          data: {
            createdAt: new Date((await databaseNow()).getTime() - 3 * MINUTE),
          },
        });
        createSession.mockClear();
      }
      const dispatch = Promise.withResolvers<string>();
      const finish = Promise.withResolvers<void>();
      createSession
        .mockImplementationOnce(async (request) => {
          dispatch.resolve(request.turnId);
          await finish.promise;
          return acceptedSession();
        })
        .mockResolvedValue(acceptedSession("session_competing_owner"));
      const interval = vi.spyOn(globalThis, "setInterval");
      vi.spyOn(control, "reconcileTurn").mockResolvedValue(undefined);
      const start = releasedId
        ? control.recoverStartingTurn(releasedId)
        : control.startTurn(input);
      start.catch(dispatch.reject);
      let turnId: string;
      try {
        turnId = await dispatch.promise;
        const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
          where: { id: turnId },
        });
        const beat = interval.mock.calls.find(([, delay]) => delay === 15_000);
        const old = new Date((await databaseNow()).getTime() - 3 * MINUTE);
        await prisma.sokoBotTurn.update({
          where: { id: turnId },
          data: {
            createdAt: old,
            reconcilerHeartbeatAt: turn.reconcilerHeartbeatAt && old,
            eveSessionId: earlyAttach ? acceptedSession().sessionId : null,
          },
        });
        if (poolBusy && beat) await tickWithBusyPool(beat[0]);
        else await beat?.[0]();

        expect(await syncTurns()).toMatchObject({ claimed: 0 });
        expect(await leaseOf(turnId)).toBe(turn.leaseToken);
        if (replaying) {
          await expect(control.startTurn(input)).resolves.toMatchObject({
            turnId,
            status: "STARTING",
            duplicate: true,
          });
        }
        expect(createSession).toHaveBeenCalledOnce();
        expect(beat).toBeDefined();
        expect(turn.reconcilerHeartbeatAt).not.toBeNull();
      } finally {
        finish.resolve();
        await Promise.allSettled([start]);
      }
      await expect(start).resolves.toMatchObject({ turnId, status: "RUNNING" });
    },
  );

  it("releases a replay that loses acknowledgement to a pause so it can be reclaimed immediately", async () => {
    await fundStart();
    const input = startInput();
    const createSession = vi
      .fn<SokoBotRuntime["createSession"]>()
      .mockRejectedValue(
        new DOMException("Acceptance response lost", "TimeoutError"),
      );
    const control = new SokoBotControlPlane({
      ...unusedRuntime,
      createSession,
    });
    await expect(control.startTurn(input)).rejects.toThrow(
      "Acceptance response lost",
    );
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: {
        sokoBotId_clientTurnId: {
          sokoBotId: botId,
          clientTurnId: input.clientTurnId,
        },
      },
    });
    expect(turn).toMatchObject({
      errorKind: "runtime_start_ambiguous",
      reconcilerHeartbeatAt: null,
    });
    const old = new Date((await databaseNow()).getTime() - 3 * MINUTE);
    await prisma.sokoBotTurn.update({
      where: { id: turn.id },
      data: { createdAt: old },
    });
    createSession.mockImplementationOnce(async () => {
      await prisma.sokoBot.update({
        where: { id: botId },
        data: { status: "PAUSED" },
      });
      return acceptedSession();
    });

    await expect(control.recoverStartingTurn(turn.id)).rejects.toThrow(
      "stopped before replay acknowledgement",
    );
    expect(
      await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turn.id },
      }),
    ).toMatchObject({
      status: "STARTING",
      eveSessionId: null,
      leaseExpiresAt: null,
      reconcilerHeartbeatAt: null,
    });

    await prisma.sokoBot.update({
      where: { id: botId },
      data: { status: "IDLE" },
    });
    createSession.mockResolvedValueOnce(acceptedSession());
    await expect(control.startTurn(input)).resolves.toMatchObject({
      turnId: turn.id,
      status: "RUNNING",
      reconciliationLeaseToken: expect.any(String),
    });
  });

  it("finds an eligible start behind 20 older proactive-paused starts", async () => {
    const now = await databaseNow();
    await prisma.sokoBot.update({
      where: { id: botId },
      data: { proactivePaused: true },
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createTurn(now, {
          status: "STARTING",
          eveSessionId: null,
          source: "SCHEDULE",
          createdAgoMs: 4 * MINUTE,
          heartbeatAgoMs: index === 0 ? MINUTE : undefined,
          leaseInMs: 12 * MINUTE,
        }),
      ),
    );
    // Both old null-beat and newly admitted stale-beat rows fill the cap.
    await createTurn(now, {
      status: "STARTING",
      eveSessionId: null,
      source: "SCHEDULE",
      createdAgoMs: 4 * MINUTE,
      leaseInMs: 12 * MINUTE,
    });
    const eligible = await createTurn(now, {
      status: "STARTING",
      eveSessionId: null,
      createdAgoMs: 3 * MINUTE,
      leaseInMs: 13 * MINUTE,
    });
    // The fixture has no snapshot. The claim is durable even though replay releases it.
    expectCoreLog(
      "warn",
      "Could not recover a Soko Bot turn whose start was abandoned",
    );
    await syncTurns();
    expect(await leaseOf(eligible)).not.toBe(LEASE);
  });

  async function claimBehindWriter<T>(
    write: (tx: Prisma.TransactionClient) => Promise<unknown>,
    claim: () => Promise<T>,
  ): Promise<T> {
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const writer = prisma.$transaction(async (tx) => {
      await write(tx);
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      locked.resolve(pid);
      await release.promise;
    });
    writer.catch(locked.reject);
    const pid = await locked.promise;
    const pending = claim();
    let finished = false;
    const markFinished = () => {
      finished = true;
    };
    pending.then(markFinished, markFinished);
    try {
      const until = performance.now() + 2_000;
      let waiting = false;
      while (!waiting && !finished && performance.now() < until) {
        const [{ blocked }] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        waiting = blocked;
      }
      expect(waiting, "recovery waits on the row writer").toBe(true);
    } finally {
      release.resolve();
      await Promise.allSettled([writer, pending]);
    }
    await writer;
    return pending;
  }

  it.each(["pause", "archive"] as const)(
    "rechecks recovery eligibility after it waits for %s",
    async (change) => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "STARTING",
        eveSessionId: null,
        createdAgoMs: 3 * MINUTE,
        leaseInMs: 13 * MINUTE,
      });
      const result = await claimBehindWriter(
        (tx) =>
          tx.sokoBot.update({
            where: { id: botId },
            data:
              change === "pause" ? { adminPausedAt: now } : { archivedAt: now },
          }),
        () =>
          new SokoBotControlPlane(unusedRuntime).recoverStartingTurn(turnId),
      );
      expect(result).toBeNull();
      expect(await leaseOf(turnId)).toBe(LEASE);
    },
  );

  it.each(["STARTING", "RUNNING"] as const)(
    "does not claim a selected %s turn after its deadline passes",
    async (status) => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status,
        eveSessionId: status === "RUNNING" ? "session_clock" : null,
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs: status === "RUNNING" ? MINUTE : undefined,
        leaseInMs: 13 * MINUTE,
      });
      const reconcile = vi
        .spyOn(sokoBotControlPlane, "reconcileTurn")
        .mockResolvedValue(undefined);
      const result = await claimBehindWriter(async (tx) => {
        if (status === "STARTING") {
          await tx.$queryRaw`
              SELECT "id" FROM "soko_bot" WHERE "id" = ${botId}::uuid FOR UPDATE
            `;
        }
        return tx.sokoBotTurn.update({
          where: { id: turnId },
          data: { deadlineAt: await databaseNow(tx) },
        });
      }, syncTurns);
      expect(result).toMatchObject({ claimed: 0, interrupted: 0 });
      expect(await leaseOf(turnId)).toBe(LEASE);
      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it("lets a sandbox call through on a live turn when the host runs 2 minutes ahead", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "RUNNING",
      eveSessionId: "session_clock",
      heartbeatAgoMs: 0,
      leaseInMs: 16 * MINUTE,
      deadlineInMs: 30_000,
    });
    // As the launcher signs it: the deadline plus a minute's grace.
    const token = issueTurnToken({
      turnId,
      sessionId: "session_clock",
      expiresAt: now.getTime() + 30_000 + 60_000,
    });
    await skewApplicationClock(2 * MINUTE);

    // An empty reasoning body fails validation: 400 means the token passed.
    const response = await sokoBotRuntimeRoutes.request(
      `/turns/${turnId}/reasoning`,
      {
        method: "POST",
        headers: {
          [SOKO_BOT_TURN_TOKEN_HEADER]: token,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(400);
  });

  it("keeps a CMO turn created just now running when the host runs 6 minutes ahead", async () => {
    const now = await databaseNow();
    const turnId = await createTurn(now, {
      status: "STARTING",
      eveSessionId: null,
      leaseInMs: 16 * MINUTE,
    });
    await skewApplicationClock(6 * MINUTE);
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
      select: TURN_ROW_SELECT,
    });

    expect(await settledTurnStatus(turn, new Date())).toBe("running");
    expect(
      (await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }))
        .status,
    ).toBe("STARTING");
  });

  it("counts a turn of today against the daily cap after the host has passed midnight", async () => {
    const now = await databaseNow();
    // The bot's day is placed around the sample: a fixed-offset zone in which
    // it is local noon, so the turn and the gate's later sample share a local
    // day at any real time of day.
    const offsetHours = 12 - now.getUTCHours();
    const ingestTimezone =
      offsetHours === 0
        ? "Etc/GMT"
        : `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
    await prisma.sokoBot.update({
      where: { id: botId },
      data: { ingestTimezone },
    });
    await createTurn(now, {
      status: "RUNNING",
      eveSessionId: "session_clock",
      heartbeatAgoMs: 0,
      leaseInMs: 16 * MINUTE,
      source: "SCHEDULE",
    });
    const msIntoLocalDay =
      (now.getTime() + offsetHours * 60 * MINUTE) % (24 * 60 * MINUTE);
    const untilLocalMidnight = 24 * 60 * MINUTE - msIntoLocalDay;
    await skewApplicationClock(untilLocalMidnight + MINUTE);

    await expect(proactiveGate(botId)).resolves.toMatchObject({
      ok: false,
      reason: "daily-limit",
      usedToday: 1,
    });
  });

  describe("a sessionless start with a heartbeat", () => {
    async function startWithHeartbeat(
      heartbeatAgoMs: number,
      overrides: { leaseInMs?: number; errorKind?: string | null } = {},
    ) {
      const now = await databaseNow();
      return createTurn(now, {
        status: "STARTING",
        eveSessionId: null,
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs,
        leaseInMs: 13 * MINUTE,
        ...overrides,
      });
    }

    it("lets a duplicate's drain under the same lease step back while the heartbeat is under 45 seconds old", async () => {
      // 5 s short of the stale threshold, so the test's own runtime stays inside it.
      const turnId = await startWithHeartbeat(40_000);

      await expect(
        new SokoBotControlPlane(unusedRuntime).reconcileTurn(
          turnId,
          undefined,
          LEASE,
        ),
      ).resolves.toBeUndefined();
      expect(await leaseOf(turnId)).toBe(LEASE);
    });

    it("does not let a duplicate's drain step back once the heartbeat is 45 seconds old", async () => {
      const turnId = await startWithHeartbeat(45_000);

      await expect(
        new SokoBotControlPlane(unusedRuntime).reconcileTurn(
          turnId,
          undefined,
          LEASE,
        ),
      ).rejects.toThrow("Runtime turn not found");
    });

    it("rejects a foreign token on a fresh first start", async () => {
      const turnId = await startWithHeartbeat(10_000, { errorKind: null });

      await expect(
        new SokoBotControlPlane(unusedRuntime).reconcileTurn(
          turnId,
          undefined,
          "foreign-lease",
        ),
      ).rejects.toBeInstanceOf(SokoBotReconciliationLeaseLostError);
    });

    it.each([
      { token: LEASE, leaseInMs: -MINUTE },
      { token: LEASE, errorKind: "runtime_start_ambiguous" },
    ])(
      "rejects drain with a fresh heartbeat and %j",
      async ({ token, ...overrides }) => {
        const turnId = await startWithHeartbeat(10_000, overrides);
        await expect(
          new SokoBotControlPlane(unusedRuntime).reconcileTurn(
            turnId,
            undefined,
            token,
          ),
        ).rejects.toThrow("Runtime turn not found");
      },
    );

    it("claims a dead recovery owner at 45 seconds even inside its lease", async () => {
      const turnId = await startWithHeartbeat(45_000, {
        errorKind: "runtime_start_ambiguous",
      });
      expectCoreLog(
        "warn",
        "Could not recover a Soko Bot turn whose start was abandoned",
      );
      await syncTurns();
      expect(await leaseOf(turnId)).not.toBe(LEASE);
    });
  });

  describe("runtime authorization", () => {
    const operations = { requireWriteScope: async () => undefined };

    async function mutate(turnId: string) {
      return prisma.$transaction(
        (tx) =>
          requireMutationAuthority(
            operations,
            tx,
            {
              turn: {
                id: turnId,
                sokoBotId: botId,
                actingUserId: userId,
                requestedByUserId: userId,
                workspaceId,
                eveSessionId: "session_clock",
                versionId: null,
                source: "CHAT",
                chainDepth: 0,
              },
              classificationConfidence: 1,
            },
            false,
          ),
        { timeout: 20_000 },
      );
    }

    it("lets a turn with 30 seconds of lease left write when the host runs a minute ahead", async () => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "RUNNING",
        eveSessionId: "session_clock",
        heartbeatAgoMs: 0,
        leaseInMs: 30_000,
      });
      await skewApplicationClock(MINUTE);

      await expect(mutate(turnId)).resolves.toMatchObject({ id: workspaceId });
    });

    it("refuses a turn whose lease ended 30 seconds ago when the host runs a minute behind", async () => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "RUNNING",
        eveSessionId: "session_clock",
        heartbeatAgoMs: 0,
        leaseInMs: -30_000,
      });
      await skewApplicationClock(-MINUTE);

      await expect(mutate(turnId)).rejects.toThrow(
        "Soko Bot turn is no longer writable",
      );
    });

    it("keeps checking the turn's intent on the clock that issued it", async () => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "RUNNING",
        eveSessionId: "session_clock",
        heartbeatAgoMs: 0,
        leaseInMs: 16 * MINUTE,
      });
      await skewApplicationClock(-MINUTE);
      // Issued on this host: 30 seconds left by its clock, already past by
      // PostgreSQL's.
      const intent = await prisma.sokoBotIntent.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requesterId: userId,
          originatingTurnId: turnId,
          desiredOutcome: "Clock intent",
          targetIds: [],
          allowedActions: [],
          acceptanceCriteria: [],
          evidenceIds: [],
          expiresAt: new Date(Date.now() + 30_000),
        },
      });
      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { intentId: intent.id, intentRevision: intent.revision },
      });

      await expect(mutate(turnId)).resolves.toMatchObject({ id: workspaceId });
    });

    it("checks a recorded intent revision and supports legacy turns without one", async () => {
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "RUNNING",
        eveSessionId: "session_clock",
        heartbeatAgoMs: 0,
        leaseInMs: MINUTE,
      });
      const intent = await prisma.sokoBotIntent.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requesterId: userId,
          originatingTurnId: turnId,
          desiredOutcome: "Create a task",
          targetIds: [],
          allowedActions: ["create_task"],
          acceptanceCriteria: [],
          evidenceIds: [],
          expiresAt: new Date(now.getTime() + MINUTE),
        },
      });
      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { intentId: intent.id, intentRevision: intent.revision + 1 },
      });
      const call = await prisma.sokoBotToolCall.create({
        data: {
          turnId,
          toolCallId: "create-task",
          capability: "create_task",
          inputHash: "hash",
        },
      });
      const targetId = randomUUID();
      const commit = () =>
        prisma.$transaction((tx) =>
          commitActionReceipt(tx, {
            turnId,
            toolCallId: call.toolCallId,
            actorBotId: botId,
            targetId,
            result: { taskId: targetId },
          }),
        );

      await expect(commit()).rejects.toMatchObject({ code: "P2025" });
      await expect(
        prisma.sokoBotToolCall.findUniqueOrThrow({ where: { id: call.id } }),
      ).resolves.toMatchObject({ status: "PENDING" });

      await prisma.sokoBotTurn.update({
        where: { id: turnId },
        data: { intentRevision: null },
      });
      await expect(commit()).resolves.toMatchObject({
        status: "COMPLETED",
        targetId,
      });
      await expect(
        prisma.sokoBotIntent.findUniqueOrThrow({ where: { id: intent.id } }),
      ).resolves.toMatchObject({ targetIds: [targetId] });
    });

    // A real lock wait needs a second connection, which PGlite (wasm32)
    // does not run beside an open transaction: there it skips, and CI's
    // PostgreSQL proves it.
    it("refuses a write whose lease ended while it waited for the turn's lock", async (context) => {
      const [{ version }] = await prisma.$queryRaw<
        { version: string }[]
      >`SELECT version()`;
      if (version.includes("wasm32")) context.skip();
      const now = await databaseNow();
      const turnId = await createTurn(now, {
        status: "RUNNING",
        eveSessionId: "session_clock",
        heartbeatAgoMs: 0,
        leaseInMs: 2_000,
      });
      const leaseEnd = now.getTime() + 2_000;
      const release = Promise.withResolvers<void>();
      const locked = Promise.withResolvers<number>();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "soko_bot_turn" WHERE "id" = ${turnId}::uuid FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          locked.resolve(pid);
          await release.promise;
        },
        { timeout: 20_000 },
      );
      holder.catch(locked.reject);
      let write: Promise<unknown> | undefined;
      try {
        const holderPid = await locked.promise;
        write = mutate(turnId);
        write.catch(() => undefined);
        // The write must be queued behind the lock while its lease is live.
        // Each phase also has its own monotonic deadline, so neither outlives
        // the test if the write fails early or PostgreSQL's clock stalls.
        const queueBy = performance.now() + 5_000;
        let queued = false;
        while (
          !queued &&
          performance.now() < queueBy &&
          (await databaseNow()).getTime() < leaseEnd
        ) {
          const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
          `;
          queued = waiting > 0;
        }
        expect(queued).toBe(true);
        // Then the lease runs out while it waits.
        const expireBy = performance.now() + 10_000;
        let expired = false;
        while (!expired && performance.now() < expireBy) {
          expired = (await databaseNow()).getTime() > leaseEnd;
        }
        expect(expired).toBe(true);
      } finally {
        release.resolve();
        await Promise.allSettled([holder, write]);
      }

      await expect(write).rejects.toThrow(
        "Soko Bot turn is no longer writable",
      );
      // Above its polling (5 s + 10 s) plus cleanup, which can wait out the
      // transactions' 20 s timeout.
    }, 45_000);
  });
});
