/**
 * Reconcilers that write one turn against a disposable PostgreSQL database.
 * The in-process loop's settle reconciles under the lease the row holds,
 * beside whoever already drains the turn: neither may lose the other's usage,
 * which settlement bills, or move the stream cursor back. A step that races
 * settlement is billed or fenced out, never lost. A writer from the release
 * before must not deadlock with this one.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-reconcile-writers.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import type {
  IndexedRuntimeEvent,
  RuntimeEvent,
  RuntimeEventStreamInput,
  RuntimeJsonValue,
  SokoBotRuntime,
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

import prisma from "@/lib/db/prisma";

// Settlement publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

// One-shot pauses inside settlement's transaction: after it read the turn,
// and after it wrote the turn. A serialization retry runs straight through.
const settlementPause = vi.hoisted(() => ({
  afterRead: undefined as (() => Promise<void>) | undefined,
  afterWrite: undefined as
    | ((tx: Prisma.TransactionClient) => Promise<void>)
    | undefined,
}));
vi.mock("./soko-bot-billing.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./soko-bot-billing.service")>();
  return {
    ...actual,
    recordSokoBotTurnUsage: async (
      ...args: Parameters<typeof actual.recordSokoBotTurnUsage>
    ) => {
      const pause = settlementPause.afterRead;
      settlementPause.afterRead = undefined;
      await pause?.();
      return actual.recordSokoBotTurnUsage(...args);
    },
  };
});
vi.mock("./soko-bot-delivery.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./soko-bot-delivery.service")>();
  return {
    ...actual,
    enqueueSokoBotDelivery: async (
      ...args: Parameters<typeof actual.enqueueSokoBotDelivery>
    ) => {
      const pause = settlementPause.afterWrite;
      settlementPause.afterWrite = undefined;
      await pause?.(args[0]);
      return actual.enqueueSokoBotDelivery(...args);
    },
  };
});

// Settlement hands route-outcome and outbox work to waitUntil: recorded, so
// each test awaits it before its fixtures go.
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn((work: Promise<unknown>) => {
    background.push(work);
  }),
}));

import { sokoBotUsageCents } from "./soko-bot-billing.service";
import {
  ACTIVE_TURN_STATUSES,
  SokoBotControlPlane,
} from "./soko-bot-control-plane.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1_000;
const LEASE = "lease_shared";
const SESSION = "session_shared";

function runtimeEvent(
  type: string,
  data: Record<string, RuntimeJsonValue> = {},
): RuntimeEvent {
  return {
    type,
    data,
    meta: { id: `evt_${randomUUID()}`, at: new Date().toISOString() },
  };
}

/** The runtime hands each reconciler, told apart by its signal, its own script. */
function scriptedRuntime(
  scripts: Map<
    AbortSignal | undefined,
    (input: RuntimeEventStreamInput) => AsyncIterable<IndexedRuntimeEvent>
  >,
): SokoBotRuntime {
  return {
    createSession: async () => {
      throw new Error("not used");
    },
    streamEvents: (input) => {
      const script = scripts.get(input.signal);
      if (!script) throw new Error("No script for this reconciler");
      return script(input);
    },
    cancelTurn: async () => undefined,
    resetSession: async () => undefined,
    inspectSession: async () => ({
      healthy: true,
      runtimeVersion: "test",
      sessionStatus: "waiting",
    }),
  };
}

async function backendPid(client: Prisma.TransactionClient): Promise<number> {
  const [{ pid }] = await client.$queryRaw<
    { pid: number }[]
  >`SELECT pg_backend_pid() AS pid`;
  return pid;
}

/**
 * True once a connection waits on `pid`'s locks; false when `stop()` holds
 * first, so a writer that ended early fails the test instead of passing it.
 */
async function waitForWaiterOn(
  pid: number,
  stop: () => boolean,
): Promise<boolean> {
  while (!stop()) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (waiting > 0) return true;
  }
  return false;
}

type Fixture = {
  userId: string;
  workspaceId?: string;
  botId?: string;
  turnId?: string;
};

/** A user with credits, a workspace, a bot and a running turn under LEASE. */
async function setUpFixture(
  f: Fixture,
  afterUser: () => Promise<void> = async () => undefined,
) {
  await prisma.user.create({
    data: {
      id: f.userId,
      name: "Writers owner",
      email: `${f.userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await afterUser();
  f.workspaceId = (
    await prisma.workspace.create({ data: { userId: f.userId } })
  ).id;
  const grant = await prisma.transaction.create({
    data: { userId: f.userId, amount: 100_000n * 10_000_000_000n },
  });
  await prisma.creditBucket.create({
    data: {
      userId: f.userId,
      amount: grant.amount,
      sourceTransactionId: grant.id,
    },
  });
  f.botId = (
    await prisma.sokoBot.create({
      data: { userId: f.userId, workspaceId: f.workspaceId },
    })
  ).id;
  f.turnId = (
    await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: f.botId,
        requestedByUserId: f.userId,
        workspaceId: f.workspaceId,
        source: "CHAT",
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: "Fixture turn",
        capabilityNames: [],
        eveSessionId: SESSION,
        eveTurnId: "eve_turn_shared",
        leaseToken: LEASE,
        leaseExpiresAt: new Date(Date.now() + HOUR),
        deadlineAt: new Date(Date.now() + HOUR),
        startedAt: new Date(),
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: "fixture",
            packet: { memory: { version: 0 } },
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

/**
 * Removes what `setUpFixture` wrote, also after it threw part-way: only by
 * the user's id, which exists before the first write, and the cascade from
 * the user takes its workspace, bot, turn, credits and usage. A filter on an
 * id setup never assigned would be undefined, which Prisma drops, deleting
 * every row of the table.
 */
async function tearDownFixture(f: Fixture | undefined) {
  if (!f) return;
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

describe.skipIf(!enabled)("reconciling beside another writer", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;
  let turnId: string;
  let writerEnded: boolean;
  let fixture: Fixture | undefined;

  beforeEach(async () => {
    writerEnded = false;
    // The id comes first, so teardown can find whatever setup wrote.
    fixture = { userId: randomUUID() };
    await setUpFixture(fixture);
    userId = fixture.userId;
    workspaceId = fixture.workspaceId as string;
    botId = fixture.botId as string;
    turnId = fixture.turnId as string;
  });

  afterEach(async () => {
    settlementPause.afterRead = undefined;
    settlementPause.afterWrite = undefined;
    while (background.length > 0)
      await Promise.allSettled(background.splice(0));
    await tearDownFixture(fixture);
    fixture = undefined;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("tears down only its own rows when setup throws part-way", async () => {
    const failed: Fixture = { userId: randomUUID() };
    await expect(
      setUpFixture(failed, async () => {
        throw new Error("Setup failed");
      }),
    ).rejects.toThrow("Setup failed");

    await tearDownFixture(failed);

    expect(await prisma.user.count({ where: { id: failed.userId } })).toBe(0);
    expect(await prisma.sokoBot.count({ where: { id: botId } })).toBe(1);
    expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(
      1,
    );
  });

  /** Runs both reconcilers; a gate a writer never reaches opens when either ends. */
  async function race(
    gates: PromiseWithResolvers<void>[],
    scripts: Map<
      AbortSignal,
      (input: RuntimeEventStreamInput) => AsyncIterable<IndexedRuntimeEvent>
    >,
  ) {
    const control = new SokoBotControlPlane(scriptedRuntime(scripts));
    const releaseAll = () => {
      writerEnded = true;
      for (const gate of gates) gate.resolve();
    };
    return Promise.allSettled(
      [...scripts.keys()].map((signal) =>
        control.reconcileTurn(turnId, signal, LEASE).finally(releaseAll),
      ),
    );
  }

  it("bills both writers' steps when each persists a different one", async () => {
    const step1 = runtimeEvent("step.completed", {
      modelId: "openai/gpt",
      usage: { inputTokens: 10, costUsd: 1 },
    });
    const step2 = runtimeEvent("step.completed", {
      modelId: "openai/gpt",
      usage: { inputTokens: 20, costUsd: 2 },
    });
    const events = [
      step1,
      step2,
      runtimeEvent("turn.completed"),
      runtimeEvent("session.waiting"),
    ];
    const at = (index: number) => ({ startIndex: index, event: events[index] });
    const bothStreaming = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const aStoredStep1 = Promise.withResolvers<void>();
    const bStoredStep2 = Promise.withResolvers<void>();
    const a = new AbortController().signal;
    const b = new AbortController().signal;

    // Both read the turn before either writes. A stores step 1; B, which saw
    // no usage yet, finds step 1 stored and stores step 2. A then finishes.
    const outcomes = await race(
      [...bothStreaming, aStoredStep1, bStoredStep2],
      new Map([
        [
          a,
          async function* () {
            bothStreaming[0].resolve();
            await bothStreaming[1].promise;
            yield at(0);
            aStoredStep1.resolve();
            await bStoredStep2.promise;
            for (const index of [1, 2, 3]) yield at(index);
          },
        ],
        [
          b,
          async function* () {
            bothStreaming[1].resolve();
            await bothStreaming[0].promise;
            await aStoredStep1.promise;
            yield at(0);
            yield at(1);
            bStoredStep2.resolve();
          },
        ],
      ]),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("COMPLETED");
    expect(turn.costUsdMicros).toBe(3_000_000n);
    expect(turn.usage).toMatchObject({ inputTokens: 30, costUsd: 3 });
    const billed = await prisma.sokoBotUsage.findFirstOrThrow({
      where: { sokoBotId: botId },
    });
    expect(billed.cents).toBe(sokoBotUsageCents(3_000_000n, true));
  });

  it("never moves the cursor back when a lagging writer replays", async () => {
    const events = [
      runtimeEvent("message.completed", { message: "First" }),
      runtimeEvent("message.completed", { message: "Second" }),
    ];
    const at = (index: number) => ({ startIndex: index, event: events[index] });
    const bothStreaming = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const bDrained = Promise.withResolvers<void>();
    const a = new AbortController().signal;
    const b = new AbortController().signal;
    let cursorAfterReplay: number | undefined;

    // B drains both events. A, which read the turn first, replays event 0.
    const outcomes = await race(
      [...bothStreaming, bDrained],
      new Map([
        [
          a,
          async function* () {
            bothStreaming[0].resolve();
            await bothStreaming[1].promise;
            await bDrained.promise;
            yield at(0);
            cursorAfterReplay = (
              await prisma.sokoBotTurn.findUniqueOrThrow({
                where: { id: turnId },
              })
            ).eveStreamIndex;
          },
        ],
        [
          b,
          async function* () {
            bothStreaming[1].resolve();
            await bothStreaming[0].promise;
            yield at(0);
            yield at(1);
            bDrained.resolve();
          },
        ],
      ]),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(cursorAfterReplay).toBe(1);
  });

  // Settlement bills the totals it read. A step that commits after that read
  // makes settlement's write conflict, and its retry bills the step. A step
  // that waits on settlement's row lock finds the lease cleared and is fenced
  // out with its event.
  const step = (costUsd: number) =>
    runtimeEvent("step.completed", {
      modelId: "openai/gpt",
      usage: { inputTokens: 10 * costUsd, costUsd },
    });

  async function settledState() {
    return {
      turn: await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turnId },
      }),
      billed: (
        await prisma.sokoBotUsage.findMany({ where: { sokoBotId: botId } })
      ).map((row) => row.cents),
      debits: (
        await prisma.transaction.findMany({
          where: { userId, amount: { lt: 0n } },
        })
      ).map((row) => row.amount),
      steps: await prisma.sokoBotEvent.count({
        where: { turnId, type: "step.completed" },
      }),
    };
  }

  it("bills a step that commits after settlement read the turn", async () => {
    // A paid step is on the turn when settlement reads it, so the stale
    // attempt debits too before its write conflicts and rolls back.
    const events = [
      step(1),
      step(2),
      runtimeEvent("turn.completed"),
      runtimeEvent("session.waiting"),
    ];
    const at = (index: number) => ({ startIndex: index, event: events[index] });
    const firstStepStored = Promise.withResolvers<void>();
    const settlerRead = Promise.withResolvers<void>();
    const secondStepStored = Promise.withResolvers<void>();
    settlementPause.afterRead = async () => {
      settlerRead.resolve();
      await secondStepStored.promise;
    };
    const stepper = new AbortController().signal;
    const settler = new AbortController().signal;

    const outcomes = await race(
      [firstStepStored, settlerRead, secondStepStored],
      new Map([
        [
          stepper,
          async function* () {
            yield at(0);
            firstStepStored.resolve();
            await settlerRead.promise;
            yield at(1);
            secondStepStored.resolve();
          },
        ],
        [
          settler,
          async function* () {
            await firstStepStored.promise;
            yield at(2);
            yield at(3);
          },
        ],
      ]),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    const charge = sokoBotUsageCents(3_000_000n, true);
    const { turn, billed, debits, steps } = await settledState();
    expect(turn.status).toBe("COMPLETED");
    expect(turn.costUsdMicros).toBe(3_000_000n);
    expect(billed).toEqual([charge]);
    expect(debits).toEqual([-charge]);
    expect(steps).toBe(2);
  });

  it("fences out a step that waits on settlement's uncommitted write", async () => {
    const events = [
      step(1),
      runtimeEvent("turn.completed"),
      runtimeEvent("session.waiting"),
    ];
    const at = (index: number) => ({ startIndex: index, event: events[index] });
    // The stepper is past its first heartbeat before settlement takes the
    // row, so what waits on settlement is its event write.
    const stepperStreaming = Promise.withResolvers<void>();
    let settlerPid: number | undefined;
    const settlerWrote = Promise.withResolvers<void>();
    const stepWaiting = Promise.withResolvers<void>();
    settlementPause.afterWrite = async (tx) => {
      settlerPid = await backendPid(tx);
      settlerWrote.resolve();
      await stepWaiting.promise;
    };
    const stepper = new AbortController().signal;
    const settler = new AbortController().signal;

    const racing = race(
      [stepperStreaming, settlerWrote, stepWaiting],
      new Map([
        [
          stepper,
          async function* () {
            stepperStreaming.resolve();
            await settlerWrote.promise;
            yield at(0);
          },
        ],
        [
          settler,
          async function* () {
            await stepperStreaming.promise;
            yield at(1);
            yield at(2);
          },
        ],
      ]),
    );
    let stepWaited = false;
    let outcomes: PromiseSettledResult<void>[] = [];
    try {
      await settlerWrote.promise;
      if (settlerPid !== undefined)
        stepWaited = await waitForWaiterOn(settlerPid, () => writerEnded);
    } finally {
      stepWaiting.resolve();
      outcomes = await racing;
    }

    expect(stepWaited).toBe(true);
    expect(outcomes[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: "Soko Bot reconciliation lease was lost",
      }),
    });
    expect(outcomes[1]?.status).toBe("fulfilled");
    const { turn, billed, debits, steps } = await settledState();
    expect(turn.status).toBe("COMPLETED");
    expect(turn.costUsdMicros ?? 0n).toBe(0n);
    expect(billed).toEqual([]);
    expect(debits).toEqual([]);
    expect(steps).toBe(0);
    // Settlement's own events stay; the fenced step's rolled back.
    expect(await prisma.sokoBotEvent.count({ where: { turnId } })).toBe(2);
  });

  // During a deploy or rollback, a drain from the release before writes the
  // same event: it inserts first, then fences. This one must take the same
  // order, or each waits on the other's lock.
  it("never deadlocks with a writer from the release before", async () => {
    const shared = runtimeEvent("message.completed", { message: "Shared" });
    const oldInserted = Promise.withResolvers<number>();
    const oldMayFence = Promise.withResolvers<void>();
    const oldWriter = prisma.$transaction(async (tx) => {
      await tx.sokoBotEvent.createMany({
        data: [
          {
            turnId,
            eveEventId: shared.meta.id,
            eveStartIndex: 0,
            sequence: 0,
            type: shared.type,
            providerAt: new Date(shared.meta.at),
          },
        ],
        skipDuplicates: true,
      });
      oldInserted.resolve(await backendPid(tx));
      await oldMayFence.promise;
      const fenced = await tx.sokoBotTurn.updateMany({
        where: {
          id: turnId,
          leaseToken: LEASE,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        data: { eveStreamIndex: 0, reconcilerHeartbeatAt: new Date() },
      });
      expect(fenced.count).toBe(1);
    });
    const signal = new AbortController().signal;
    const control = new SokoBotControlPlane(
      scriptedRuntime(
        new Map([
          [
            signal,
            async function* () {
              yield { startIndex: 0, event: shared };
            },
          ],
        ]),
      ),
    );
    // Observed from the moment it starts, so a rejection while the monitor
    // awaits its query is never unhandled.
    let newWriter: Promise<PromiseSettledResult<void>> = Promise.resolve({
      status: "fulfilled",
      value: undefined,
    });
    let newWaited = false;
    let outcomes: PromiseSettledResult<void>[] = [];

    try {
      // An old writer that fails before inserting opens this gate too.
      const oldPid = await Promise.race([
        oldInserted.promise,
        oldWriter.then(
          () => null,
          () => null,
        ),
      ]);
      if (oldPid !== null) {
        let newDone = false;
        newWriter = Promise.allSettled([
          control.reconcileTurn(turnId, signal, LEASE),
        ]).then(([outcome]) => {
          newDone = true;
          return outcome;
        });
        // The new writer's insert waits on the old one's uncommitted event.
        newWaited = await waitForWaiterOn(oldPid, () => newDone);
      }
    } finally {
      oldMayFence.resolve();
      const [oldOutcome] = await Promise.allSettled([oldWriter]);
      outcomes = [oldOutcome, await newWriter];
    }

    expect(newWaited).toBe(true);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    // One event, written once; both writers' cursor writes landed on it.
    expect(await prisma.sokoBotEvent.count({ where: { turnId } })).toBe(1);
    expect(
      (await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }))
        .eveStreamIndex,
    ).toBe(0);
  });

  /**
   * The rows a drain writes for these events, as `persistEvent` writes them:
   * a failure keeps its code in the payload, and the cursor ends on the last.
   */
  function projectedEvents(
    events: { type: string; code?: string }[],
    from = 0,
  ): Prisma.SokoBotEventCreateManyInput[] {
    return events.map(({ type, code }, offset) => ({
      turnId,
      eveEventId: `evt_${randomUUID()}`,
      eveStartIndex: from + offset,
      sequence: from + offset,
      type,
      summary: code ?? type,
      payload: type.endsWith(".failed")
        ? { code: code ?? "unknown" }
        : undefined,
      providerAt: new Date(),
    }));
  }

  /** What a drain that died after `persistEvent` left behind. */
  async function persistedByDeadDrain(
    events: { type: string; code?: string }[],
    turn: Prisma.SokoBotTurnUpdateInput = {},
  ) {
    await prisma.sokoBotEvent.createMany({ data: projectedEvents(events) });
    await prisma.sokoBotTurn.update({
      where: { id: turnId },
      data: {
        eveStreamIndex: events.length - 1,
        costUsdMicros: 1_000_000n,
        ...turn,
      },
    });
  }

  /** The runtime has nothing after the cursor; a drain must not wait on it. */
  async function* nothingAfterCursor(): AsyncIterable<IndexedRuntimeEvent> {}

  it.each([
    ["session.waiting", "COMPLETED", null],
    ["session.completed", "COMPLETED", null],
    ["input.requested", "FAILED", "runtime_input_unsupported"],
  ])(
    "settles from a %s a dead drain persisted",
    async (trigger, status, errorKind) => {
      await persistedByDeadDrain([
        { type: "turn.completed" },
        { type: trigger },
      ]);
      const signal = new AbortController().signal;

      const [outcome] = await race([], new Map([[signal, nothingAfterCursor]]));

      expect(outcome.status).toBe("fulfilled");
      const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turnId },
      });
      expect(turn.status).toBe(status);
      expect(turn.errorKind).toBe(errorKind);
      expect(turn.leaseToken).toBeNull();
    },
  );

  it("settles a persisted session.failed with its own code, not a later interruption", async () => {
    // The dead drain's catch overwrote the projected code on the row.
    await persistedByDeadDrain(
      [{ type: "session.failed", code: "provider_down" }],
      {
        errorKind: "runtime_stream_interrupted",
        errorDetail: "settlement failed",
      },
    );
    const signal = new AbortController().signal;

    const [outcome] = await race([], new Map([[signal, nothingAfterCursor]]));

    expect(outcome.status).toBe("fulfilled");
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("FAILED");
    expect(turn.errorKind).toBe("provider_down");
    expect(turn.errorDetail).toBeNull();
  });

  it("settles from the outcome committed with the trigger it found", async () => {
    // Another drain under the same lease commits turn.failed and
    // session.waiting after this drain read the turn and its prior outcome,
    // while this drain's first heartbeat waits on that commit.
    const signal = new AbortController().signal;
    const control = new SokoBotControlPlane(
      scriptedRuntime(new Map([[signal, nothingAfterCursor]])),
    );
    const otherMayCommit = Promise.withResolvers<void>();
    const otherHoldsRow = Promise.withResolvers<number>();
    let drained = false;
    const other = prisma.$transaction(
      async (tx) => {
        await tx.sokoBotEvent.createMany({
          data: projectedEvents([
            { type: "turn.failed", code: "model_gateway_error" },
            { type: "session.waiting" },
          ]),
        });
        await tx.sokoBotTurn.update({
          where: { id: turnId },
          data: {
            eveStreamIndex: 1,
            errorKind: "model_gateway_error",
            errorDetail: "Gateway refused",
          },
        });
        otherHoldsRow.resolve(await backendPid(tx));
        await otherMayCommit.promise;
      },
      { timeout: 60_000 },
    );
    let drain: Promise<PromiseSettledResult<void>[]> | undefined;
    let waited = false;
    try {
      const pid = await otherHoldsRow.promise;
      drain = Promise.allSettled([
        control.reconcileTurn(turnId, signal, LEASE),
      ]).finally(() => {
        drained = true;
      });
      waited = await waitForWaiterOn(pid, () => drained);
    } finally {
      otherMayCommit.resolve();
      await other;
    }
    const [outcome] = (await drain) ?? [];

    expect(waited).toBe(true);
    expect(outcome?.status).toBe("fulfilled");
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn.status).toBe("FAILED");
    expect(turn.errorKind).toBe("model_gateway_error");
    expect(turn.errorDetail).toBe("Gateway refused");
  });

  it("G9: settles a cancellation from its consumed trigger without opening the stream", async () => {
    await persistedByDeadDrain(
      [{ type: "turn.cancelled" }, { type: "session.waiting" }],
      {
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date(),
      },
    );
    const signal = new AbortController().signal;
    const stream = vi.fn(nothingAfterCursor);
    const control = new SokoBotControlPlane(
      scriptedRuntime(new Map([[signal, stream]])),
    );

    await control.reconcileTurn(turnId, signal, LEASE);

    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
    });
    expect(turn).toMatchObject({ status: "CANCELLED", leaseToken: null });
    expect(stream).not.toHaveBeenCalled();
  });

  it("still settles a cancelled turn from what it streams after a persisted trigger", async () => {
    await persistedByDeadDrain(
      [{ type: "turn.completed" }, { type: "session.waiting" }],
      { status: "CANCEL_REQUESTED", cancellationRequestedAt: new Date() },
    );
    const signal = new AbortController().signal;
    const streamed = [
      runtimeEvent("turn.cancelled"),
      runtimeEvent("session.waiting"),
    ];

    const [outcome] = await race(
      [],
      new Map([
        [
          signal,
          async function* () {
            for (const [offset, event] of streamed.entries())
              yield { startIndex: 2 + offset, event };
          },
        ],
      ]),
    );

    expect(outcome.status).toBe("fulfilled");
    expect(
      (await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }))
        .status,
    ).toBe("CANCELLED");
  });

  it("bills once when two drains both reach settlement from one persisted trigger", async () => {
    await persistedByDeadDrain([
      { type: "turn.completed" },
      { type: "session.waiting" },
    ]);
    const a = new AbortController().signal;
    const b = new AbortController().signal;
    const control = new SokoBotControlPlane(
      scriptedRuntime(
        new Map([
          [a, nothingAfterCursor],
          [b, nothingAfterCursor],
        ]),
      ),
    );
    let drains: Promise<void>[] = [];
    let firstPaused = false;
    // The first drain in settlement has read the active turn; it resumes
    // only after the other drain has settled it.
    settlementPause.afterRead = async () => {
      firstPaused = true;
      await Promise.race(drains.map((drain) => drain.catch(() => undefined)));
    };
    drains = [a, b].map((signal) =>
      control.reconcileTurn(turnId, signal, LEASE),
    );

    const outcomes = await Promise.allSettled(drains);

    expect(firstPaused).toBe(true);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      (await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }))
        .status,
    ).toBe("COMPLETED");
    expect(
      await prisma.sokoBotUsage.count({ where: { sokoBotId: botId } }),
    ).toBe(1);
  });
});
