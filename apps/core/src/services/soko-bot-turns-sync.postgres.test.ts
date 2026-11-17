/**
 * The watchdog's abandoned-start recovery against a disposable PostgreSQL
 * database. A sessionless STARTING turn whose holder set a heartbeat and then
 * died (a recovery claim, or a start that retained its lease after a failed
 * acknowledgement) is reclaimed once that heartbeat is older than the grace,
 * not left until its deadline. A live holder renews its lease, so it keeps it.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-turns-sync.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { RuntimeTurnInput } from "@sokosumi/soko-bot";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";

// The in-memory runtime, whatever the shell sets: an evaluation allowance
// would otherwise start the in-process loop on these fixtures.
vi.mock("@/lib/soko-bot/factory", async () => {
  const { InMemorySokoBotRuntime } = await import(
    "@/lib/soko-bot/in-memory-runtime"
  );
  const runtime = new InMemorySokoBotRuntime();
  return { getSokoBotRuntime: () => runtime };
});

import { SOKO_BOT_START_RECOVERY_GRACE_MS } from "./soko-bot-control-plane.service";
import { sokoBotTurnsSyncService } from "./soko-bot-turns-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const STALE_MS = SOKO_BOT_START_RECOVERY_GRACE_MS + MINUTE;
const OLD_LEASE = "lease_of_the_dead_holder";
/** The control plane's heartbeat interval. */
const HEARTBEAT_MS = 15_000;

describe.skipIf(!enabled)("recovering a stranded sessionless start", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;
  let turnId: string;

  async function createBot(data: { proactivePaused?: boolean } = {}) {
    botId = (
      await prisma.sokoBot.create({ data: { userId, workspaceId, ...data } })
    ).id;
  }

  /** A STARTING turn with its context, never acknowledged. */
  async function insertStart(holder: {
    heartbeatAgoMs: number;
    errorKind: string | null;
    source?: "CHAT" | "SCHEDULE";
    createdAgoMs?: number;
  }) {
    const heartbeatAt = new Date(Date.now() - holder.heartbeatAgoMs);
    const source = holder.source ?? "CHAT";
    return (
      await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source,
          status: "STARTING",
          clientTurnId: randomUUID(),
          userMessage: "Stranded turn",
          capabilityNames: [],
          leaseToken: OLD_LEASE,
          leaseExpiresAt: new Date(heartbeatAt.getTime() + 16 * MINUTE),
          reconcilerHeartbeatAt: heartbeatAt,
          errorKind: holder.errorKind,
          createdAt: new Date(
            Date.now() - (holder.createdAgoMs ?? 10 * MINUTE),
          ),
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
                  source,
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

  async function strandedStart(holder: {
    heartbeatAgoMs: number;
    errorKind: string | null;
  }) {
    await createBot();
    turnId = await insertStart(holder);
  }

  function sync() {
    return sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      // The database can hold other turns; this test owns only its bot's.
      sokoBotIds: [botId],
    });
  }

  function readTurn() {
    return prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } });
  }

  /** Holds the runtime start until released, so a worker stays mid-startup. */
  function gateRuntimeStart() {
    const runtime = getSokoBotRuntime();
    const start = runtime.createSession.bind(runtime);
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(runtime, "createSession").mockImplementationOnce(
      async (input: RuntimeTurnInput) => {
        reached.resolve();
        await release.promise;
        return start(input);
      },
    );
    return { reached: reached.promise, release: () => release.resolve() };
  }

  /** Raw writes the control plane makes, so a test can await a renewal. */
  function recordRawWrites() {
    const writes: Promise<unknown>[] = [];
    const execute = prisma.$executeRaw.bind(prisma);
    vi.spyOn(prisma, "$executeRaw").mockImplementation(((
      ...args: Parameters<typeof prisma.$executeRaw>
    ) => {
      const write = execute(...args);
      writes.push(write);
      return write;
    }) as typeof prisma.$executeRaw);
    return () => Promise.all(writes.splice(0));
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
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // The cascade from the user takes its workspace, bot and turn.
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reclaims a recovery claim whose worker died", async () => {
    await strandedStart({
      heartbeatAgoMs: STALE_MS,
      errorKind: "runtime_start_ambiguous",
    });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 1, interrupted: 0 });
    const turn = await readTurn();
    expect(turn.status).toBe("RUNNING");
    expect(turn.eveSessionId).not.toBeNull();
    expect(turn.leaseToken).not.toBe(OLD_LEASE);
  });

  it("reclaims a start that retained its lease after a failed acknowledgement and died", async () => {
    await strandedStart({ heartbeatAgoMs: STALE_MS, errorKind: null });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 1, interrupted: 0 });
    const turn = await readTurn();
    expect(turn.status).toBe("RUNNING");
    expect(turn.eveSessionId).not.toBeNull();
    expect(turn.leaseToken).not.toBe(OLD_LEASE);
  });

  it("leaves a live recovery claim with a fresh heartbeat to its worker", async () => {
    await strandedStart({
      heartbeatAgoMs: 10_000,
      errorKind: "runtime_start_ambiguous",
    });
    const before = await readTurn();

    const result = await sync();

    expect(result).toMatchObject({ claimed: 0, interrupted: 0 });
    const turn = await readTurn();
    expect(turn.status).toBe("STARTING");
    expect(turn.leaseToken).toBe(OLD_LEASE);
    expect(turn.reconcilerHeartbeatAt).toEqual(before.reconcilerHeartbeatAt);
    expect(turn.errorKind).toBe("runtime_start_ambiguous");
  });

  it("keeps a recovery that is still starting past the grace, because it renews its lease", async () => {
    await strandedStart({
      heartbeatAgoMs: STALE_MS,
      errorKind: "runtime_start_ambiguous",
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const renewals = recordRawWrites();
    const gate = gateRuntimeStart();
    const recovery = sync();
    await gate.reached;
    const { leaseToken: recoveryLease } = await readTurn();
    expect(recoveryLease).not.toBe(OLD_LEASE);

    // The runtime start outlasts the grace: the claim's stamp ages past it...
    await prisma.$executeRaw`
      UPDATE "soko_bot_turn"
      SET "reconcilerHeartbeatAt" = "reconcilerHeartbeatAt" - interval '130 seconds'
      WHERE "id" = ${turnId}::uuid
    `;
    await renewals();
    // ...while the worker's heartbeat keeps renewing it.
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await renewals();

    expect(await sync()).toMatchObject({ claimed: 0, interrupted: 0 });
    gate.release();
    expect(await recovery).toMatchObject({ claimed: 1, interrupted: 0 });
    const turn = await readTurn();
    expect(turn.status).toBe("RUNNING");
    expect(turn.leaseToken).toBe(recoveryLease);
  });

  it("lets a recovery that lost its lease to a live successor end quietly", async () => {
    await strandedStart({
      heartbeatAgoMs: STALE_MS,
      errorKind: "runtime_start_ambiguous",
    });
    const gate = gateRuntimeStart();
    const recovery = sync();
    await gate.reached;
    await prisma.sokoBotTurn.update({
      where: { id: turnId },
      data: { leaseToken: "lease_of_the_successor" },
    });

    gate.release();

    expect(await recovery).toMatchObject({ claimed: 0, interrupted: 0 });
    const turn = await readTurn();
    expect(turn.status).toBe("STARTING");
    expect(turn.leaseToken).toBe("lease_of_the_successor");
  });

  it("recovers a chat turn behind a full batch of starts its bot's pause holds", async () => {
    await createBot({ proactivePaused: true });
    for (let index = 0; index < 20; index += 1) {
      await insertStart({
        heartbeatAgoMs: STALE_MS,
        errorKind: "runtime_start_ambiguous",
        source: "SCHEDULE",
        createdAgoMs: 30 * MINUTE,
      });
    }
    turnId = await insertStart({ heartbeatAgoMs: STALE_MS, errorKind: null });

    const result = await sync();

    expect(result).toMatchObject({ claimed: 1, interrupted: 0 });
    expect((await readTurn()).status).toBe("RUNNING");
  });
});
