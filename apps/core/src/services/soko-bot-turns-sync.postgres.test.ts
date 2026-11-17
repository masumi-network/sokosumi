/**
 * The watchdog's abandoned-start recovery against a disposable PostgreSQL
 * database. A sessionless STARTING turn whose holder set a heartbeat and then
 * died (a recovery claim, or a start that retained its lease after a failed
 * acknowledgement) is reclaimed once that heartbeat is older than the grace,
 * not left until its deadline. A live claim keeps its lease.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-turns-sync.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";

import { SOKO_BOT_START_RECOVERY_GRACE_MS } from "./soko-bot-control-plane.service";
import { sokoBotTurnsSyncService } from "./soko-bot-turns-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const OLD_LEASE = "lease_of_the_dead_holder";

describe.skipIf(!enabled)("recovering a stranded sessionless start", () => {
  let userId: string;
  let botId: string;
  let turnId: string;

  /** A STARTING turn with its context, created 10 minutes ago, never acknowledged. */
  async function strandedStart(holder: {
    heartbeatAgoMs: number;
    errorKind: string | null;
  }) {
    const heartbeatAt = new Date(Date.now() - holder.heartbeatAgoMs);
    const workspaceId = (await prisma.workspace.create({ data: { userId } }))
      .id;
    botId = (await prisma.sokoBot.create({ data: { userId, workspaceId } })).id;
    turnId = (
      await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "STARTING",
          clientTurnId: randomUUID(),
          userMessage: "Stranded turn",
          capabilityNames: [],
          leaseToken: OLD_LEASE,
          leaseExpiresAt: new Date(heartbeatAt.getTime() + 16 * MINUTE),
          reconcilerHeartbeatAt: heartbeatAt,
          errorKind: holder.errorKind,
          createdAt: new Date(Date.now() - 10 * MINUTE),
          deadlineAt: new Date(Date.now() + HOUR),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: "fixture",
              // Replay parses the packet before it restarts the runtime.
              packet: {
                schemaVersion: 1,
                generatedAt: new Date().toISOString(),
                hash: "fixture",
                trigger: {
                  source: "CHAT",
                  route: "DIRECT_RESPONSE",
                  confidence: 1,
                  requestedOutcome: "Stranded turn",
                  askedBy: {
                    kind: "OWNER",
                    name: "Owner",
                    trust: "untrusted-data",
                  },
                },
                actor: {},
                workspace: {},
                projects: [],
                tasks: [],
                coworkers: [],
                agents: [],
                jobs: [],
                pendingDecisions: [],
                recentTurns: [],
                memory: { version: 0, hash: null, markdown: "" },
                counts: {},
                omissions: {},
              },
              byteSize: 0,
              tokenEstimate: 0,
              counts: {},
              omissions: {},
            },
          },
        },
      })
    ).id;
  }

  function sync() {
    return sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      // The database can hold other turns; this test owns only its bot's.
      sokoBotIds: [botId],
    });
  }

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Stranded owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });

  afterEach(async () => {
    // The cascade from the user takes its workspace, bot and turn.
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reclaims a recovery claim whose worker died", async () => {
    await strandedStart({
      heartbeatAgoMs: SOKO_BOT_START_RECOVERY_GRACE_MS + MINUTE,
      errorKind: "runtime_start_ambiguous",
    });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 1, interrupted: 0 });
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("RUNNING");
    expect(turn.eveSessionId).not.toBeNull();
    expect(turn.leaseToken).not.toBe(OLD_LEASE);
  });

  it("reclaims a start that retained its lease after a failed acknowledgement and died", async () => {
    await strandedStart({
      heartbeatAgoMs: SOKO_BOT_START_RECOVERY_GRACE_MS + MINUTE,
      errorKind: null,
    });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 1, interrupted: 0 });
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("RUNNING");
    expect(turn.eveSessionId).not.toBeNull();
    expect(turn.leaseToken).not.toBe(OLD_LEASE);
  });

  it("leaves a live recovery claim with a fresh heartbeat to its worker", async () => {
    await strandedStart({
      heartbeatAgoMs: 10_000,
      errorKind: "runtime_start_ambiguous",
    });
    const before = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 0, interrupted: 0 });
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("STARTING");
    expect(turn.leaseToken).toBe(OLD_LEASE);
    expect(turn.reconcilerHeartbeatAt).toEqual(before.reconcilerHeartbeatAt);
    expect(turn.errorKind).toBe("runtime_start_ambiguous");
  });
});
