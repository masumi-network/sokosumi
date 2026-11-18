/**
 * Turn ownership against a disposable PostgreSQL database while the
 * application clock runs ahead of or behind PostgreSQL. Lease, heartbeat,
 * deadline and cutoff times come from PostgreSQL, so a host's skew cannot
 * change a decision about a turn: the recovery claim, the watchdog's stale
 * claim, runtime and sandbox authorization, CMO's stall check and the daily
 * cap decide the same way at any skew, and the stamps writers leave are
 * PostgreSQL time.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-lease-clock.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import {
  SOKO_BOT_TURN_TOKEN_HEADER,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
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
    expectNear(claimed.leaseExpiresAt, now.getTime() + 16 * MINUTE);
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
    const grant = await prisma.transaction.create({
      data: { userId, amount: 100_000n * 10_000_000_000n },
    });
    await prisma.creditBucket.create({
      data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
    });
    vi.spyOn(getSokoBotRuntime(), "createSession").mockImplementation(
      async () => ({
        sessionId: "session_started",
        runtimeVersion: "test",
        acceptedAt: new Date().toISOString(),
      }),
    );
    const now = await skewApplicationClock(5 * MINUTE);

    const started = await sokoBotControlPlane.startTurn({
      userId,
      workspaceId,
      clientTurnId: randomUUID(),
      message: "What is on my board?",
      source: "CHAT",
      presetRoute: { route: "DELEGATE_TASK", reason: "fixture" },
    });

    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: started.turnId },
    });
    expect(turn.status).toBe("RUNNING");
    expectNear(turn.createdAt, now.getTime());
    expectNear(turn.reconcilerHeartbeatAt, now.getTime());
    expectNear(turn.leaseExpiresAt, now.getTime() + 16 * MINUTE);
    expectNear(turn.deadlineAt, now.getTime() + 60 * MINUTE);
  });

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
    await createTurn(now, {
      status: "RUNNING",
      eveSessionId: "session_clock",
      heartbeatAgoMs: 0,
      leaseInMs: 16 * MINUTE,
      source: "SCHEDULE",
    });
    const nextUtcMidnight = new Date(now);
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    await skewApplicationClock(
      nextUtcMidnight.getTime() - now.getTime() + MINUTE,
    );

    await expect(proactiveGate(botId)).resolves.toMatchObject({
      ok: false,
      reason: "daily-limit",
      usedToday: 1,
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
      const holderPid = await locked.promise;
      const write = mutate(turnId);
      write.catch(() => undefined);
      // The write is queued behind the lock, then the lease runs out.
      for (;;) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
        `;
        if (waiting > 0) break;
      }
      let pgNow = await databaseNow();
      while (pgNow.getTime() <= now.getTime() + 2_000)
        pgNow = await databaseNow();
      release.resolve();
      await holder;

      await expect(write).rejects.toThrow(
        "Soko Bot turn is no longer writable",
      );
    });
  });
});
