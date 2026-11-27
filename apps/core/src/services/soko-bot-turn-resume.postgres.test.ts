import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
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
vi.mock("@/lib/network", async (original) => ({
  ...(await original<typeof import("@/lib/network")>()),
  isPreprodOn: () => flag.on,
}));
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
      await mainnet.networkDb.sokoBotUsage.deleteMany({
        where: { userId },
      });
      await mainnet.networkDb.creditBucket.deleteMany({ where: { userId } });
      await mainnet.networkDb.transaction.deleteMany({ where: { userId } });
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

  function tick(sokoBotId: string) {
    return cron.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: [sokoBotId],
    });
  }

  function loadTurn(id: string) {
    return prisma.sokoBotTurn.findUniqueOrThrow({ where: { id } });
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
    const grant = await mainnet.networkDb.transaction.create({
      data: { userId, amount: 100_000n * 10_000_000_000n },
    });
    await mainnet.networkDb.creditBucket.create({
      data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
    });
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
    const expectedStatements = onSplitLayout ? 10 : 35;
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
    ).rejects.toThrow("Unknown Network: null");
    expect(await loadTurn(turn.id)).toEqual(turn);
  });

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
      expect(
        await mainnet.networkDb.sokoBotUsage.count({ where: { userId } }),
      ).toBe(0);
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
});
