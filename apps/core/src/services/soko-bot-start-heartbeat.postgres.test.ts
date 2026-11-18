/**
 * A sessionless STARTING turn whose owner writes a heartbeat, against a
 * disposable PostgreSQL database. A heartbeat younger than the stale threshold
 * (45 s) is a live owner: a duplicate's drain returns quietly, and neither a
 * duplicate start nor the watchdog's abandoned-start scan claims the turn. An
 * older heartbeat is a dead owner, recoverable like a start that never wrote
 * one. Readers accept this before any writer renews (expand step).
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-start-heartbeat.postgres.test.ts
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
import { sokoBotTurnsSyncService } from "./soko-bot-turns-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const LEASE = "start_heartbeat";
const MESSAGE = "Heartbeat turn";

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

describe.skipIf(!enabled)("a sessionless start with a heartbeat", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Heartbeat owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId, ingestTimezone: "UTC" },
      })
    ).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // The cascade from the user takes its workspace, bot and turns.
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A first start that has not been acknowledged, with its owner's heartbeat. */
  async function createStart(turn: {
    createdAgoMs: number;
    heartbeatAgoMs: number;
  }): Promise<{ id: string; clientTurnId: string }> {
    const now = await databaseNow();
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    return prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source: "CHAT",
        status: "STARTING",
        clientTurnId: randomUUID(),
        userMessage: MESSAGE,
        capabilityNames: [],
        leaseToken: LEASE,
        leaseExpiresAt: at(16 * MINUTE - turn.createdAgoMs),
        reconcilerHeartbeatAt: at(-turn.heartbeatAgoMs),
        deadlineAt: at(60 * MINUTE),
        createdAt: at(-turn.createdAgoMs),
      },
      select: { id: true, clientTurnId: true },
    }) as Promise<{ id: string; clientTurnId: string }>;
  }

  async function leaseOf(turnId: string): Promise<string | null> {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
      select: { leaseToken: true },
    });
    return turn.leaseToken;
  }

  function duplicateStart(clientTurnId: string) {
    return sokoBotControlPlane.startTurn({
      userId,
      workspaceId,
      clientTurnId,
      message: MESSAGE,
      source: "CHAT",
    });
  }

  async function watchdogRecoveries(): Promise<string[]> {
    const recover = vi
      .spyOn(sokoBotControlPlane, "recoverStartingTurn")
      .mockResolvedValue(null);
    await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: [botId],
    });
    return recover.mock.calls.map(([turnId]) => turnId);
  }

  describe("renewed 5 seconds ago: a live owner", () => {
    it("lets a duplicate's drain under the same lease return quietly", async () => {
      const turn = await createStart({
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs: 5 * SECOND,
      });

      await expect(
        new SokoBotControlPlane(unusedRuntime).reconcileTurn(
          turn.id,
          undefined,
          LEASE,
        ),
      ).resolves.toBeUndefined();
      expect(await leaseOf(turn.id)).toBe(LEASE);
    });

    it("is not claimed by a recovery, however old the row", async () => {
      const turn = await createStart({
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs: 5 * SECOND,
      });

      const recovered = await new SokoBotControlPlane(
        unusedRuntime,
      ).recoverStartingTurn(turn.id);

      expect(recovered).toBeNull();
      expect(await leaseOf(turn.id)).toBe(LEASE);
    });

    it("hands a duplicate start the owner's lease without claiming it", async () => {
      const turn = await createStart({
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs: 5 * SECOND,
      });

      const started = await duplicateStart(turn.clientTurnId);

      expect(started).toMatchObject({
        turnId: turn.id,
        duplicate: true,
        status: "STARTING",
        reconciliationLeaseToken: LEASE,
      });
      expect(await leaseOf(turn.id)).toBe(LEASE);
    });

    it("is left out of the watchdog's abandoned-start scan", async () => {
      await createStart({
        createdAgoMs: 3 * MINUTE,
        heartbeatAgoMs: 5 * SECOND,
      });

      expect(await watchdogRecoveries()).toEqual([]);
    });
  });

  // Created 90 s ago: younger than the 120 s grace a start without a heartbeat
  // gets, so only the stale heartbeat makes these recoverable.
  describe("renewed last 60 seconds ago: a dead owner", () => {
    it("is claimed by a recovery", async () => {
      const turn = await createStart({
        createdAgoMs: 90 * SECOND,
        heartbeatAgoMs: 60 * SECOND,
      });

      // The fixture has no context snapshot, so the claimed replay stops there.
      await expect(
        new SokoBotControlPlane(unusedRuntime).recoverStartingTurn(turn.id),
      ).rejects.toThrow("Ambiguous Soko Bot start is not ready for replay");
      expect(await leaseOf(turn.id)).not.toBe(LEASE);
    });

    it("is recovered by a duplicate start", async () => {
      const turn = await createStart({
        createdAgoMs: 90 * SECOND,
        heartbeatAgoMs: 60 * SECOND,
      });

      await expect(duplicateStart(turn.clientTurnId)).rejects.toThrow(
        "Ambiguous Soko Bot start is not ready for replay",
      );
      expect(await leaseOf(turn.id)).not.toBe(LEASE);
    });

    it("is selected by the watchdog's abandoned-start scan", async () => {
      const turn = await createStart({
        createdAgoMs: 90 * SECOND,
        heartbeatAgoMs: 60 * SECOND,
      });

      expect(await watchdogRecoveries()).toEqual([turn.id]);
    });

    it("is not drained quietly by a duplicate under the dead lease", async () => {
      const turn = await createStart({
        createdAgoMs: 90 * SECOND,
        heartbeatAgoMs: 60 * SECOND,
      });

      await expect(
        new SokoBotControlPlane(unusedRuntime).reconcileTurn(
          turn.id,
          undefined,
          LEASE,
        ),
      ).rejects.toThrow("Runtime turn not found");
    });
  });
});
