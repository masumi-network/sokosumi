import "@hono/zod-openapi";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { SOKO_BOT_TURN_TOKEN_HEADER } from "@sokosumi/soko-bot";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/network", async (original) => {
  const network = await original<typeof import("@/lib/network")>();
  return {
    ...network,
    isPreprodOn: () => flag.on,
    requireNetworkOn: (value: unknown) =>
      flag.on ? network.requireNetwork(value) : network.requireNetworkOn(value),
  };
});
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@vercel/functions", async (original) => ({
  ...(await original<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => background.push(work),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("detached turn resume on PostgreSQL", () => {
  let prisma: typeof import("@/lib/db/prisma").default;
  let runtime: typeof import("./soko-bot-runtime.service").sokoBotRuntimeService;
  let controlPlane: typeof import("./soko-bot-control-plane.service").sokoBotControlPlane;
  let cron: typeof import("./soko-bot-turns-sync.service").sokoBotTurnsSyncService;
  let routes: typeof import("@/routes/v1/soko-bot-runtime").default;
  let issueToken: typeof import("@/lib/soko-bot/sandbox/turn-token").issueTurnToken;
  let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
  let mainnet: ReturnType<
    typeof import("@/lib/db/network-scope").createNetworkScope
  >;
  let preprod: typeof mainnet | undefined;
  let keys: string[];

  beforeAll(async () => {
    flag.on = onSplitLayout;
    vi.stubEnv("NETWORK_PREPROD_ENABLED", String(onSplitLayout));
    ({ default: prisma } = await import("@/lib/db/prisma"));
    ({ sokoBotRuntimeService: runtime } = await import(
      "./soko-bot-runtime.service"
    ));
    ({ sokoBotControlPlane: controlPlane } = await import(
      "./soko-bot-control-plane.service"
    ));
    ({ sokoBotTurnsSyncService: cron } = await import(
      "./soko-bot-turns-sync.service"
    ));
    ({ default: routes } = await import("@/routes/v1/soko-bot-runtime"));
    ({ issueTurnToken: issueToken } = await import(
      "@/lib/soko-bot/sandbox/turn-token"
    ));
    ({ createPersonalWorkspace } = await import(
      "@/helpers/personal-workspace"
    ));
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    mainnet = createNetworkScope("mainnet");
    if (onSplitLayout) preprod = createNetworkScope("preprod");
    const control = await import("@/helpers/preprod-control");
    keys = [control.PREPROD_PAUSE_KEY, control.PREPROD_GENERATION_KEY];
    const { errorHandler } = await import("@/helpers/error-handler");
    routes.onError(errorHandler);
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  async function seed(
    network: "mainnet" | "preprod" | null,
    options: {
      attached?: boolean;
      expired?: boolean;
      staleLease?: boolean;
    } = {},
  ) {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Turn reader",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    onTestFinished(async () => {
      const scopes =
        network === "preprod" && preprod ? [mainnet, preprod] : [mainnet];
      for (const { networkDb } of scopes) {
        await networkDb.sokoBotUsage.deleteMany({ where: { userId } });
        await networkDb.creditBucket.deleteMany({ where: { userId } });
        await networkDb.transaction.deleteMany({ where: { userId } });
      }
      await prisma.subscription.deleteMany({ where: { referenceId: userId } });
      await prisma.user.delete({ where: { id: userId } });
    });
    const { id: workspaceId } = await createPersonalWorkspace(userId);
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId, status: "RUNNING" },
    });
    const sessionId = randomUUID();
    const now = Date.now();
    const turn = await prisma.sokoBotTurn.create({
      data: {
        network,
        preprodGeneration: network === "preprod" ? 7 : null,
        sokoBotId: bot.id,
        requestedByUserId: userId,
        workspaceId,
        source: "CHAT",
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: "Turn reader fixture",
        capabilityNames: [],
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
        eveSessionId: options.attached ? sessionId : null,
        leaseToken: "fixture",
        leaseExpiresAt: new Date(now + (options.staleLease ? -1 : 60_000)),
        deadlineAt: new Date(now + (options.expired ? -1 : 60_000)),
        reconcilerHeartbeatAt: options.staleLease ? new Date(0) : new Date(now),
        costUsdMicros: 100_000n,
      },
    });
    return { bot, sessionId, turn, userId, workspaceId };
  }

  async function control(pause: string, generation: string) {
    const before = await prisma.syncMetadata.findMany({
      where: { key: { in: keys } },
    });
    onTestFinished(async () => {
      await prisma.syncMetadata.deleteMany({ where: { key: { in: keys } } });
      await prisma.syncMetadata.createMany({ data: before });
    });
    for (const [index, cursorId] of [pause, generation].entries()) {
      const key = keys[index];
      await prisma.syncMetadata.upsert({
        where: { key },
        create: { key, cursorId, lastSyncedAt: new Date() },
        update: { cursorId },
      });
    }
  }

  function postReasoning(turnId: string, sessionId: string, text = " ") {
    return routes.request(`/turns/${turnId}/reasoning`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SOKO_BOT_TURN_TOKEN_HEADER]: issueToken({
          turnId,
          sessionId,
          expiresAt: Date.now() + 60_000,
        }),
      },
      body: JSON.stringify({ text }),
    });
  }

  function tick(...sokoBotIds: string[]) {
    return cron.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds,
    });
  }

  function loadTurn(id: string) {
    return prisma.sokoBotTurn.findUniqueOrThrow({ where: { id } });
  }

  async function fund(userId: string) {
    const grant = await mainnet.networkDb.transaction.create({
      data: { userId, amount: 100_000n * 10_000_000_000n },
    });
    await mainnet.networkDb.creditBucket.create({
      data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
    });
  }

  it("keeps the Mainnet callback's statements and attachment on the original rows", async () => {
    await control("open", "8");
    const { bot, sessionId, turn, userId } = await seed("mainnet");
    const recorder = recordStatements();
    let response: Response;
    try {
      response = await postReasoning(turn.id, sessionId);
    } finally {
      recorder.restore();
    }

    expect(response.status, await response.text()).toBe(200);
    expect(recorder.statements.flat()).not.toContain(keys[0]);
    expect(recorder.statements.flat()).not.toContain(keys[1]);
    expect(recorder.statements).toHaveLength(18);
    expect(await loadTurn(turn.id)).toMatchObject({
      network: "mainnet",
      status: "RUNNING",
      eveSessionId: sessionId,
    });
    expect(
      await prisma.sokoBot.findUnique({ where: { id: bot.id } }),
    ).toMatchObject({ status: "RUNNING", eveSessionId: sessionId });
    expect(
      await mainnet.networkDb.sokoBotUsage.count({ where: { userId } }),
    ).toBe(0);
  });

  it("keeps the Mainnet expiry settlement and charge", async () => {
    await control("open", "8");
    const { bot, turn, userId } = await seed("mainnet", { expired: true });
    await fund(userId);
    const recorder = recordStatements();
    try {
      const settlement = controlPlane.expireTurn(turn.id);
      if (onSplitLayout) {
        // The original settlement reads SokoBotUsage through the shared client.
        await expect(settlement).rejects.toMatchObject({ code: "P2021" });
      } else {
        await expect(settlement).resolves.toBe(true);
      }
      await Promise.all(background.splice(0));
    } finally {
      recorder.restore();
    }
    expect(recorder.statements.flat()).not.toContain(keys[0]);
    expect(recorder.statements.flat()).not.toContain(keys[1]);
    const usage = await mainnet.networkDb.sokoBotUsage.findMany({
      where: { referenceId: turn.id },
      select: { cents: true },
    });
    const ledger = await mainnet.networkDb.transaction.findMany({
      where: { userId, amount: { lt: 0 } },
      select: { amount: true },
    });
    // The debit is the credits module's: `recordSpend`'s two inserts, where
    // Prisma's nested create sent three (soko-bot-usage-spend.postgres.test.ts).
    const expectedStatements = onSplitLayout ? 10 : 34;
    expect(recorder.statements.length).toBe(expectedStatements);
    expect(await loadTurn(turn.id)).toMatchObject(
      onSplitLayout
        ? { status: "RUNNING" }
        : { status: "FAILED", errorKind: "turn_deadline_exceeded" },
    );
    expect(
      await prisma.sokoBot.findUnique({ where: { id: bot.id } }),
    ).toMatchObject({ status: onSplitLayout ? "RUNNING" : "ERROR" });
    expect(
      await prisma.sokoBotDelivery.count({ where: { turnId: turn.id } }),
    ).toBe(onSplitLayout ? 0 : 1);
    expect(usage).toEqual(onSplitLayout ? [] : [{ cents: 100_000_000_000n }]);
    expect(ledger).toEqual(
      onSplitLayout ? [] : [{ amount: -100_000_000_000n }],
    );
  });

  it("refuses a missing turn Network after the catch-up gate", async () => {
    const { turn, sessionId } = await seed(null);
    await expect(
      runtime.authorize({ turnId: turn.id, sessionId }),
    ).rejects.toMatchObject({ status: 409, kind: "soko_bot_network_stale" });
    expect(await loadTurn(turn.id)).toMatchObject({
      status: "FAILED",
      errorKind: "soko_bot_network_stale",
    });
  });

  it("retires an untagged stalled turn and reconciles the next turn", async () => {
    // The open queue is where a missing tag can still reach the claim loop.
    flag.on = true;
    onTestFinished(() => {
      flag.on = onSplitLayout;
    });
    await control("open", "7");
    const untagged = await seed(null, { attached: true, staleLease: true });
    const tagged = await seed("mainnet", {
      attached: true,
      staleLease: true,
    });
    await prisma.sokoBotTurn.update({
      where: { id: tagged.turn.id },
      data: { reconcilerHeartbeatAt: new Date(1) },
    });
    const reconcile = vi
      .spyOn(controlPlane, "reconcileTurn")
      .mockResolvedValue();
    onTestFinished(() => reconcile.mockRestore());

    await expect(tick(untagged.bot.id, tagged.bot.id)).resolves.toMatchObject({
      claimed: 1,
      reconciled: 1,
    });
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(
      tagged.turn.id,
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(await loadTurn(untagged.turn.id)).toMatchObject({
      status: "FAILED",
      errorKind: "soko_bot_network_stale",
    });
    expect(
      await mainnet.networkDb.sokoBotUsage.count({
        where: { referenceId: untagged.turn.id },
      }),
    ).toBe(0);
  });

  it.each(["expired", "cancelled", "abandoned"] as const)(
    "retires an untagged %s turn without charging",
    async (path) => {
      flag.on = true;
      onTestFinished(() => {
        flag.on = onSplitLayout;
      });
      await control("open", "7");
      const { bot, turn, userId } = await seed(null, {
        expired: path === "expired",
        staleLease: true,
      });
      if (path !== "expired") {
        await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: {
            status: path === "cancelled" ? "CANCEL_REQUESTED" : "STARTING",
          },
        });
      }
      await expect(tick(bot.id)).resolves.toMatchObject({ interrupted: 0 });
      expect(await loadTurn(turn.id)).toMatchObject({
        status: "FAILED",
        errorKind: "soko_bot_network_stale",
      });
      expect(
        await mainnet.networkDb.sokoBotUsage.count({
          where: { referenceId: turn.id },
        }),
      ).toBe(0);
      expect(
        await mainnet.networkDb.transaction.count({
          where: { userId, amount: { lt: 0 } },
        }),
      ).toBe(0);
    },
  );

  // Public lets the original billing code reach the ledger. A split-layout
  // failure could otherwise hide an accidental charge behind P2021.
  it.skipIf(onSplitLayout).each(["callback", "expiry"] as const)(
    "fails a stale Preprod %s without a usage row or debit",
    async (path) => {
      await control("open", "8");
      flag.on = true;
      onTestFinished(() => {
        flag.on = false;
      });
      const { turn, sessionId, userId } = await seed("preprod", {
        attached: true,
        expired: path === "expiry",
      });
      await fund(userId);

      if (path === "callback") {
        const response = await postReasoning(turn.id, sessionId);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          kind: "soko_bot_network_stale",
        });
      } else {
        await expect(controlPlane.expireTurn(turn.id)).resolves.toBe(true);
      }
      await Promise.all(background.splice(0));
      expect(await loadTurn(turn.id)).toMatchObject({
        status: "FAILED",
        errorKind: "soko_bot_network_stale",
      });
      expect
        .soft(
          await mainnet.networkDb.sokoBotUsage.count({
            where: { referenceId: turn.id },
          }),
        )
        .toBe(0);
      expect
        .soft(
          await mainnet.networkDb.transaction.findMany({
            where: { userId, amount: { lt: 0 } },
            select: { amount: true },
          }),
        )
        .toEqual([]);
    },
  );

  it.skipIf(!onSplitLayout)(
    "returns the saved Preprod scope and attaches the session",
    async () => {
      await control("open", "7");
      const { sessionId, turn, userId } = await seed("preprod");
      const authorized = await runtime.authorize({
        sessionId,
        turnId: turn.id,
      });
      expect(authorized.scope.network).toBe("preprod");
      expect(await loadTurn(turn.id)).toMatchObject({
        eveSessionId: sessionId,
        status: "RUNNING",
      });
      expect(
        await mainnet.networkDb.sokoBotUsage.count({ where: { userId } }),
      ).toBe(0);
    },
  );

  it.skipIf(!onSplitLayout)(
    "claims a stalled turn from the open generation",
    async () => {
      await control("open", "7");
      const { turn, bot, userId } = await seed("preprod", {
        attached: true,
        staleLease: true,
      });
      const reconcile = vi
        .spyOn(controlPlane, "reconcileTurn")
        .mockResolvedValue();
      onTestFinished(() => reconcile.mockRestore());
      await expect(tick(bot.id)).resolves.toMatchObject({
        claimed: 1,
        reconciled: 1,
      });
      expect(reconcile).toHaveBeenCalledWith(
        turn.id,
        expect.any(AbortSignal),
        expect.any(String),
      );
      expect(await loadTurn(turn.id)).toMatchObject({
        network: "preprod",
        preprodGeneration: 7,
        status: "RUNNING",
        leaseToken: expect.not.stringMatching(/^fixture$/),
      });
      expect(
        await mainnet.networkDb.sokoBotUsage.count({ where: { userId } }),
      ).toBe(0);
    },
  );

  it.skipIf(!onSplitLayout).each([
    {
      name: "off",
      pause: "open",
      generation: "7",
      status: 403,
      kind: "preprod_off",
    },
    {
      name: "paused",
      pause: "paused",
      generation: "7",
      status: 503,
      kind: "preprod_paused",
    },
    {
      name: "unavailable",
      pause: "open",
      generation: "broken",
      status: 503,
      kind: "preprod_control_unavailable",
    },
    {
      name: "stale",
      pause: "open",
      generation: "8",
      status: 409,
      kind: "soko_bot_network_stale",
    },
    {
      name: "stale while paused",
      pause: "paused",
      generation: "8",
      status: 409,
      kind: "soko_bot_network_stale",
    },
  ])("refuses a $name Preprod callback and cron pickup", async (state) => {
    if (state.name === "unavailable") {
      expectCoreLog(
        "error",
        "Could not read the Preprod pause and generation",
        2,
      );
    }
    await control(state.pause, state.generation);
    flag.on = state.name !== "off";
    onTestFinished(() => {
      flag.on = true;
    });
    const callback = await seed("preprod", { attached: true });
    const scan = await seed("preprod", { attached: true, staleLease: true });
    const response = await postReasoning(
      callback.turn.id,
      callback.sessionId,
      "reasoning",
    );
    expect(response.status).toBe(state.status);
    expect(await response.json()).toMatchObject({ kind: state.kind });
    const result = await tick(scan.bot.id);
    await Promise.all(background.splice(0));
    expect(result.claimed).toBe(0);
    for (const { turn, userId } of [callback, scan]) {
      const saved = await loadTurn(turn.id);
      if (state.status === 409) {
        expect(saved).toMatchObject({
          status: "FAILED",
          errorKind: state.kind,
          leaseToken: null,
        });
      } else {
        expect(saved).toEqual(turn);
      }
      expect(
        await prisma.sokoBotRuntimeEvent.count({ where: { turnId: turn.id } }),
      ).toBe(0);
      if (!preprod) throw new Error("Expected a split-layout Preprod scope");
      for (const { networkDb } of [mainnet, preprod]) {
        expect(
          await networkDb.sokoBotUsage.count({
            where: { referenceId: turn.id },
          }),
        ).toBe(0);
        expect(
          await networkDb.transaction.count({
            where: { userId, amount: { lt: 0 } },
          }),
        ).toBe(0);
      }
    }
  });

  it.skipIf(!onSplitLayout).each(["pause", "raise"] as const)(
    "sees a %s committed after loading the turn, and accepts when the reader wins",
    async (operation) => {
      await control("open", "7");
      const { sessionId, turn } = await seed("preprod");
      const operator = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await operator.connect();
      onTestFinished(() => operator.end());
      const schema = testSchemaNames().DATABASE_SCHEMA_SHARED;
      const findUnique = prisma.sokoBotTurn.findUnique.bind(prisma.sokoBotTurn);
      const read = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const spy = vi
        .spyOn(prisma.sokoBotTurn, "findUnique")
        .mockImplementationOnce((args) => {
          const pending = (async () => {
            const result = await findUnique(args);
            read.resolve();
            await resume.promise;
            return result;
          })();
          return pending as ReturnType<typeof findUnique>;
        });
      onTestFinished(() => spy.mockRestore());

      await operator.query("BEGIN");
      await operator.query(
        `UPDATE "${schema}".sync_metadata SET "cursorId" = $1 WHERE "key" = $2`,
        operation === "pause" ? ["paused", keys[0]] : ["open", keys[0]],
      );
      if (operation === "raise") {
        await operator.query(
          `UPDATE "${schema}".sync_metadata SET "cursorId" = '8' WHERE "key" = $1`,
          [keys[1]],
        );
      }
      const reader = runtime.authorize({ sessionId, turnId: turn.id });
      await read.promise;
      const rejected = expect(reader).rejects.toMatchObject({
        status: operation === "pause" ? 503 : 409,
      });
      await operator.query("COMMIT");
      resume.resolve();
      await rejected;
      await Promise.all(background.splice(0));

      const winner = await seed("preprod");
      for (const [index, cursorId] of ["open", "7"].entries()) {
        await operator.query(
          `UPDATE "${schema}".sync_metadata SET "cursorId" = $1 WHERE "key" = $2`,
          [cursorId, keys[index]],
        );
      }
      await operator.query("BEGIN");
      await operator.query(
        `UPDATE "${schema}".sync_metadata SET "cursorId" = $1 WHERE "key" = $2`,
        operation === "pause" ? ["paused", keys[0]] : ["8", keys[1]],
      );
      try {
        await expect(
          runtime.authorize({
            sessionId: winner.sessionId,
            turnId: winner.turn.id,
          }),
        ).resolves.toMatchObject({ scope: { network: "preprod" } });
      } finally {
        await operator.query("COMMIT");
      }
    },
  );

  it("keeps the Mainnet cron statement count with Preprod off", async () => {
    flag.on = false;
    onTestFinished(() => {
      flag.on = onSplitLayout;
    });
    await control("paused", "8");
    const { bot, turn } = await seed("mainnet", {
      attached: true,
      staleLease: true,
    });
    const reconcile = vi
      .spyOn(controlPlane, "reconcileTurn")
      .mockResolvedValue();
    onTestFinished(() => reconcile.mockRestore());
    const recorder = recordStatements();
    try {
      await expect(tick(bot.id)).resolves.toMatchObject({
        claimed: 1,
        reconciled: 1,
      });
    } finally {
      recorder.restore();
    }
    expect(recorder.statements.flat()).not.toContain(keys[0]);
    expect(recorder.statements.flat()).not.toContain(keys[1]);
    expect(recorder.statements).toHaveLength(12);
    expect(await loadTurn(turn.id)).toMatchObject({
      network: "mainnet",
      status: "RUNNING",
      leaseToken: expect.not.stringMatching(/^fixture$/),
    });
  });

  it.skipIf(!onSplitLayout).each(["off", "paused"] as const)(
    "makes progress in all four Mainnet queues behind 20 %s Preprod turns",
    async (state) => {
      await control("paused", "7");
      flag.on = state !== "off";
      onTestFinished(() => {
        flag.on = true;
      });
      const blocked = await seed("preprod");
      const allowed = await seed("mainnet");
      const queues = ["expiry", "cancellation", "recovery", "claim"] as const;
      const rows = await prisma.sokoBotTurn.createManyAndReturn({
        data: queues.flatMap((queue) =>
          [blocked, allowed].flatMap(({ turn }, index) =>
            Array.from({ length: index === 0 ? 20 : 1 }, () => ({
              id: randomUUID(),
              network: turn.network,
              preprodGeneration: turn.preprodGeneration,
              sokoBotId: turn.sokoBotId,
              workspaceId: turn.workspaceId,
              requestedByUserId: turn.requestedByUserId,
              clientTurnId: randomUUID(),
              userMessage: queue,
              capabilityNames: [],
              source: "CHAT" as const,
              status:
                queue === "recovery"
                  ? ("STARTING" as const)
                  : queue === "cancellation"
                    ? ("CANCEL_REQUESTED" as const)
                    : ("RUNNING" as const),
              createdAt: new Date(index),
              deadlineAt:
                queue === "expiry" ? new Date(index) : turn.deadlineAt,
              eveSessionId: queue === "claim" ? randomUUID() : null,
              reconcilerHeartbeatAt: new Date(index),
            })),
          ),
        ),
      });
      const mainnetIds = queues.map(
        (queue) =>
          rows.find(
            (row) => row.userMessage === queue && row.network === "mainnet",
          )?.id,
      );
      const expiry = vi
        .spyOn(controlPlane, "expireTurn")
        .mockResolvedValue(false);
      const cancellation = vi
        .spyOn(controlPlane, "settleUndeliverableCancellation")
        .mockResolvedValue(false);
      const recovery = vi
        .spyOn(controlPlane, "recoverStartingTurn")
        .mockResolvedValue(null);
      const reconcile = vi
        .spyOn(controlPlane, "reconcileTurn")
        .mockResolvedValue();
      onTestFinished(() => {
        for (const spy of [expiry, cancellation, recovery, reconcile])
          spy.mockRestore();
      });

      await cron.syncActiveTurns({
        abortSignal: new AbortController().signal,
        shouldContinue: () => true,
        sokoBotIds: [blocked.bot.id, allowed.bot.id],
      });

      expect.soft(expiry).toHaveBeenCalledExactlyOnceWith(mainnetIds[0]);
      expect.soft(cancellation).toHaveBeenCalledExactlyOnceWith(mainnetIds[1]);
      expect.soft(recovery).toHaveBeenCalledExactlyOnceWith(mainnetIds[2]);
      expect
        .soft(reconcile)
        .toHaveBeenCalledExactlyOnceWith(
          mainnetIds[3],
          expect.any(AbortSignal),
          expect.any(String),
        );
      expect(
        await prisma.sokoBotTurn.findMany({
          where: { sokoBotId: blocked.bot.id, id: { not: blocked.turn.id } },
          orderBy: { id: "asc" },
        }),
      ).toEqual(
        rows
          .filter((row) => row.network === "preprod")
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    },
  );

  it.skipIf(onSplitLayout).each(["pause", "raise"] as const)(
    "settles without charging when %s commits after expiry admission",
    async (action) => {
      flag.on = true;
      onTestFinished(() => {
        flag.on = false;
      });
      await control("open", "7");
      const { turn, userId } = await seed("preprod", { expired: true });
      const grant = await mainnet.networkDb.transaction.create({
        data: { userId, amount: 100_000n * 10_000_000_000n },
      });
      await mainnet.networkDb.creditBucket.create({
        data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
      });
      const operator = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await operator.connect();
      onTestFinished(() => operator.end());
      const transact = prisma.$transaction.bind(prisma);
      const seam = vi
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce((async (
          ...args: Parameters<typeof transact>
        ) => {
          await operator.query(
            'UPDATE public.sync_metadata SET "cursorId" = $1 WHERE "key" = $2',
            action === "pause" ? ["paused", keys[0]] : ["8", keys[1]],
          );
          return transact(...args);
        }) as typeof transact);
      onTestFinished(() => seam.mockRestore());

      await expect(controlPlane.expireTurn(turn.id)).resolves.toBe(true);
      await Promise.all(background.splice(0));
      expect
        .soft(
          await mainnet.networkDb.sokoBotUsage.count({
            where: { referenceId: turn.id },
          }),
        )
        .toBe(0);
      expect
        .soft(
          await mainnet.networkDb.transaction.findMany({
            where: { userId, amount: { lt: 0 } },
            select: { amount: true },
          }),
        )
        .toEqual([]);
      expect(await loadTurn(turn.id)).toMatchObject({
        status: "FAILED",
        errorKind:
          action === "raise"
            ? "soko_bot_network_stale"
            : "turn_deadline_exceeded",
      });
    },
  );

  it.skipIf(!onSplitLayout)(
    "leaves the launch lease unchanged when completion is paused",
    async () => {
      await control("paused", "7");
      const { turn, sessionId } = await seed("preprod", { attached: true });

      await controlPlane.reconcileRuntimeCompletion(
        turn.id,
        sessionId,
        "fixture",
      );
      expect(await loadTurn(turn.id)).toEqual(turn);
    },
  );

  it.skipIf(!onSplitLayout)(
    "does not clear another session when finishing a stale turn without one",
    async () => {
      const { bot, turn } = await seed("preprod");
      const storedBot = await prisma.sokoBot.update({
        where: { id: bot.id },
        data: { eveSessionId: randomUUID(), status: "RUNNING" },
      });
      await expect(controlPlane.finishStaleTurn(turn.id)).resolves.toBe(true);
      await Promise.all(background.splice(0));

      expect(
        await prisma.sokoBot.findUnique({ where: { id: bot.id } }),
      ).toEqual(storedBot);
      expect(
        await prisma.sokoBotDelivery.count({ where: { turnId: turn.id } }),
      ).toBe(0);
    },
  );

  it.skipIf(!onSplitLayout)(
    "leaves the in-process turn open when its authorization is paused",
    async () => {
      await control("paused", "7");
      const { turn, sessionId, userId, workspaceId, bot } = await seed(
        "preprod",
        {
          attached: true,
        },
      );
      const { InProcessSokoBotRuntime } = await import(
        "@/lib/soko-bot/in-process-runtime"
      );
      await new InProcessSokoBotRuntime().createSession({
        sessionId,
        turnId: turn.id,
        reconciliationLeaseToken: "fixture",
        sokoBotId: bot.id,
        userId,
        workspaceId,
        message: turn.userMessage,
      });
      await Promise.all(background.splice(0));
      expect(await loadTurn(turn.id)).toEqual(turn);
      expect(
        await prisma.sokoBotRuntimeEvent.count({
          where: {
            turnId: turn.id,
            type: { in: ["turn.failed", "session.waiting"] },
          },
        }),
      ).toBe(0);
    },
  );

  async function runRunner(
    turnId: string,
    sessionId: string,
    options?: {
      respond?: (path: string) => Promise<Response | undefined>;
      realStart?: boolean;
      shortCallbackTimeout?: boolean;
    },
  ) {
    const token = issueToken({
      turnId,
      sessionId,
      reconciliationLeaseToken: "fixture",
      expiresAt: Date.now() + 60_000,
    });
    const paths: string[] = [];
    const statuses: number[] = [];
    const prefix = `/v1/soko-bot-runtime/turns/${turnId}`;
    const server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const path = new URL(request.url).pathname.slice(prefix.length);
        paths.push(path);
        if (path === "/start" && !options?.realStart)
          return Response.json({
            system: "Answer the user",
            message: "Hello",
            model: "google/gemini-3.6-flash",
            capabilities: [],
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
            maxSteps: 1,
          });
        const response =
          (await options?.respond?.(path)) ??
          (await routes.fetch(
            new Request(`http://localhost/turns/${turnId}${path}`, {
              method: request.method,
              body: await request.text(),
              headers: {
                ...Object.fromEntries(request.headers),
                [SOKO_BOT_TURN_TOKEN_HEADER]: token,
              },
            }),
          ));
        statuses.push(response.status);
        return response;
      },
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    onTestFinished(() => {
      server.close();
    });
    const preload = Buffer.from(`
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (ms) => timeout(ms === 120_000 ? 500 : ms);
    `).toString("base64");
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
            ),
            fileURLToPath(
              new URL("../soko-bot-runner/index.ts", import.meta.url),
            ),
          ],
          {
            env: {
              PATH: process.env.PATH,
              ...(options?.shortCallbackTimeout
                ? {
                    NODE_OPTIONS: `--import=data:text/javascript;base64,${preload}`,
                  }
                : {}),
              SOKO_BOT_CORE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
              SOKO_BOT_TURN_ID: turnId,
            },
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let output = "";
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
        onTestFinished(() => {
          if (child.exitCode === null) child.kill();
        });
      },
    );
    return { ...result, paths, statuses };
  }

  it.skipIf(onSplitLayout)(
    "reports a Mainnet startup failure once and records the failed outcome",
    async () => {
      await control("open", "8");
      const { bot, turn, sessionId } = await seed("mainnet", {
        attached: true,
      });
      await prisma.sokoBot.update({
        where: { id: bot.id },
        data: { eveSessionId: sessionId },
      });
      const context = vi
        .spyOn(runtime, "getContext")
        .mockRejectedValueOnce(new Error("context store hiccup"));
      onTestFinished(() => context.mockRestore());
      const sandbox = await import("@/lib/soko-bot/sandbox/sandbox-runtime");
      const stopSandbox = vi
        .spyOn(sandbox, "stopTurnSandbox")
        .mockResolvedValue();
      onTestFinished(() => stopSandbox.mockRestore());
      expectCoreLog("error", "A Soko Bot turn could not start in its sandbox");

      const recorder = recordStatements();
      const result = await runRunner(turn.id, sessionId, {
        realStart: true,
      }).finally(() => recorder.restore());
      await Promise.all(background.splice(0));

      expect(recorder.statements.flat()).not.toContain(keys[0]);
      expect(recorder.statements.flat()).not.toContain(keys[1]);
      expect(context).toHaveBeenCalledTimes(1);
      expect(result.paths).toEqual(["/start", "/fail"]);
      expect(result.statuses).toEqual([409, 200]);
      expect(result.code, result.output).toBe(1);
      const events = await prisma.sokoBotRuntimeEvent.findMany({
        where: { turnId: turn.id },
        orderBy: { startIndex: "asc" },
        select: { type: true, data: true },
      });
      expect(events.map(({ type }) => type)).toEqual([
        "session.started",
        "turn.started",
        "message.received",
        "turn.failed",
        "session.waiting",
      ]);
      expect(events[3]?.data).toMatchObject({
        code: "runner_exited",
        message: expect.stringContaining("Core answered 409"),
      });
      expect(await loadTurn(turn.id)).toMatchObject({
        status: "RUNNING",
        leaseToken: expect.not.stringMatching(/^fixture$/),
      });
    },
    30_000,
  );

  it.skipIf(!onSplitLayout).each([
    { state: "off", pause: "open", generation: "7", status: 403 },
    { state: "stale", pause: "open", generation: "8", status: 409 },
    { state: "paused", pause: "paused", generation: "7", status: 503 },
  ])(
    "stops cleanly when Preprod is $state at startup",
    async (scenario) => {
      flag.on = scenario.state !== "off";
      onTestFinished(() => {
        flag.on = true;
      });
      await control(scenario.pause, scenario.generation);
      const { turn, sessionId } = await seed("preprod", { attached: true });

      const result = await runRunner(turn.id, sessionId, {
        realStart: true,
        shortCallbackTimeout: scenario.state === "paused",
      });
      await Promise.all(background.splice(0));

      expect(result.paths).toEqual(["/start"]);
      expect(result.statuses).toEqual([scenario.status]);
      expect(result.code, result.output).toBe(0);
    },
    30_000,
  );

  it.skipIf(!onSplitLayout)(
    "stops the runner on a model gateway Preprod off refusal",
    async () => {
      flag.on = false;
      onTestFinished(() => {
        flag.on = true;
      });
      const { turn, sessionId } = await seed("preprod", { attached: true });

      const result = await runRunner(turn.id, sessionId);

      expect(result.paths).toEqual(["/start", "/gateway/language-model"]);
      expect(result.code, result.output).toBe(0);
      expect(await loadTurn(turn.id)).toEqual(turn);
    },
    30_000,
  );

  it.skipIf(onSplitLayout)(
    "leaves the turn for reconciliation when the runner outwaits its Preprod retry budget",
    async () => {
      flag.on = true;
      onTestFinished(() => {
        flag.on = false;
      });
      await control("open", "7");
      const { turn, sessionId, userId } = await seed("preprod", {
        attached: true,
      });
      const grant = await mainnet.networkDb.transaction.create({
        data: { userId, amount: 100_000n * 10_000_000_000n },
      });
      await mainnet.networkDb.creditBucket.create({
        data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
      });
      const setPause = (paused: boolean) =>
        prisma.syncMetadata.update({
          where: { key: keys[0] },
          data: { cursorId: paused ? "paused" : "open" },
        });
      const result = await runRunner(turn.id, sessionId, {
        shortCallbackTimeout: true,
        async respond(path) {
          if (path === "/gateway/language-model") {
            return new Response(
              [
                { type: "text-start", id: "test" },
                { type: "text-delta", id: "test", delta: "Answer" },
                { type: "text-end", id: "test" },
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: { total: 10 },
                    outputTokens: { total: 3 },
                  },
                },
              ]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          if (path === "/complete") await setPause(true);
          if (path === "/fail") await setPause(false);
        },
      });
      await Promise.all(background.splice(0));

      expect
        .soft(
          await mainnet.networkDb.sokoBotUsage.count({
            where: { referenceId: turn.id },
          }),
        )
        .toBe(0);
      expect
        .soft(result.paths)
        .toEqual(["/start", "/gateway/language-model", "/complete"]);
      expect(result.code, result.output).toBe(0);
      expect(await loadTurn(turn.id)).toEqual(turn);
    },
    30_000,
  );
});
