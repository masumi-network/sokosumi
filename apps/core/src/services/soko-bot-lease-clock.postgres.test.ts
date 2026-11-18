/**
 * Turn ownership against a disposable PostgreSQL database while the
 * application clock runs ahead of PostgreSQL. Lease, heartbeat and cutoff
 * times come from PostgreSQL, so a host's skew cannot change who owns a
 * turn: the recovery claim, the watchdog's stale claim and runtime
 * authorization decide the same way at any skew.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-lease-clock.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { SokoBotRuntime } from "@sokosumi/soko-bot";
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

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

import {
  SokoBotControlPlane,
  sokoBotControlPlane,
} from "./soko-bot-control-plane.service";
import { requireMutationAuthority } from "./soko-bot-runtime/authorization";
import type { RuntimeOperations } from "./soko-bot-runtime/operations";
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
    botId = (await prisma.sokoBot.create({ data: { userId, workspaceId } })).id;
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
    },
  ): Promise<string> {
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    const created = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source: "CHAT",
        status: turn.status,
        clientTurnId: randomUUID(),
        userMessage: "Clock turn",
        capabilityNames: [],
        eveSessionId: turn.eveSessionId,
        leaseToken: LEASE,
        leaseExpiresAt: at(turn.leaseInMs),
        reconcilerHeartbeatAt:
          turn.heartbeatAgoMs === undefined ? null : at(-turn.heartbeatAgoMs),
        deadlineAt: at(60 * MINUTE),
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
  });

  describe("runtime authorization", () => {
    const operations = {
      requireWriteScope: async () => undefined,
    } as Pick<RuntimeOperations, "requireWriteScope"> as RuntimeOperations;

    async function mutate(turnId: string) {
      return prisma.$transaction((tx) =>
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
  });
});
