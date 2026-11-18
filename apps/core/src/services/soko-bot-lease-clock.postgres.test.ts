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

import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import sokoBotRuntimeRoutes from "@/routes/v1/soko-bot-runtime";
import { expectCoreLog } from "@/test/core-log";

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

import {
  SokoBotControlPlane,
  sokoBotControlPlane,
} from "./soko-bot-control-plane.service";
import { proactiveGate } from "./soko-bot-proactive.service";
import { requireMutationAuthority } from "./soko-bot-runtime/authorization";
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
      errorKind?: string;
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
        errorKind: turn.errorKind,
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
      acknowledgedByCaller: true,
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
      overrides: { leaseInMs?: number; errorKind?: string } = {},
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

    it.each([
      { token: "foreign-lease" },
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
