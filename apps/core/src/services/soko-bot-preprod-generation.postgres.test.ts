/**
 * Who writes `chat_room_mention.network` and the Preprod generation on the
 * four rows work resumes from, on a real PostgreSQL. A Mainnet row is the
 * same write as before plus empty columns and reads neither control key; on
 * the split layout with Preprod on and open, a Preprod row carries the
 * current generation, and while Preprod is paused or unavailable none is
 * written.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/services/soko-bot-preprod-generation.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import type { SokoBotCapability } from "@sokosumi/soko-bot";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { shouldReportHttpException } from "@/helpers/error";
import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const { caller } = vi.hoisted(() => ({
  /** The request's caller, set before the Network scope is built. */
  caller: { current: undefined as unknown },
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<unknown>,
  ) => {
    c.set("isAuthenticated", true);
    c.set("authContext", caller.current);
    return next();
  },
}));
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));
// The mention's turn is not this file's subject: the dispatch stays out.
vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: vi.fn(),
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn(async () => undefined),
  publishChatRoomMessageRealtime: vi.fn(async () => undefined),
}));
vi.mock("@/helpers/chat-room-message-created-effects", () => ({
  emitChatRoomMessageCreatedEffects: vi.fn(),
  invalidateChatRoomMessageReaders: vi.fn(async () => undefined),
}));
vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: vi.fn(),
}));
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: vi.fn(),
  shouldEmitChatDirectMessageNotifications: () => false,
}));
vi.mock("@/helpers/chat-human-mentions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/chat-human-mentions")>()),
  emitChatMessageNotifications: vi.fn(),
}));
// Turn reservation is the subject, not funding (the lease suites cover it).
vi.mock("./soko-bot-billing.service", async (original) => ({
  ...(await original<typeof import("./soko-bot-billing.service")>()),
  requireSokoBotTurnFunding: vi.fn(),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Loading Core's routes and services cold takes seconds; CI is slower. */
const COLD_IMPORT_TIMEOUT_MS = 60_000;

describe.skipIf(!enabled)(
  "Preprod generation and mention Network writers",
  () => {
    let prisma: typeof import("@/lib/db/prisma").default;
    let control: typeof import("@/helpers/preprod-control");
    let controlPlane: typeof import("./soko-bot-control-plane.service").sokoBotControlPlane;
    let createSchedule: typeof import("./soko-bot-schedule.service").createSokoBotSchedule;
    let runtime: typeof import("./soko-bot-runtime.service").sokoBotRuntimeService;
    let transactions: typeof import("@/lib/db/transaction");
    let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
    let app: InstanceType<typeof import("@/lib/hono").OpenAPIHonoWithAuth>;
    /** Both control rows before this file ran, restored after each case. */
    let savedControl: { key: string; cursorId: string | null }[] = [];

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      prisma = (await import("@/lib/db/prisma")).default;
      control = await import("@/helpers/preprod-control");
      controlPlane = (await import("./soko-bot-control-plane.service"))
        .sokoBotControlPlane;
      createSchedule = (await import("./soko-bot-schedule.service"))
        .createSokoBotSchedule;
      runtime = (await import("./soko-bot-runtime.service"))
        .sokoBotRuntimeService;
      transactions = await import("@/lib/db/transaction");
      ({ createPersonalWorkspace } = await import(
        "@/helpers/personal-workspace"
      ));
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const mountPost = (
        await import("@/routes/v1/chats/rooms/[id]/messages/post")
      ).default;
      app = new OpenAPIHonoWithAuth();
      mountPost(app);
      savedControl = await prisma.syncMetadata.findMany({
        where: {
          key: {
            in: [control.PREPROD_PAUSE_KEY, control.PREPROD_GENERATION_KEY],
          },
        },
        select: { key: true, cursorId: true },
      });
    }, COLD_IMPORT_TIMEOUT_MS);

    afterEach(async () => {
      vi.restoreAllMocks();
      await prisma.syncMetadata.deleteMany({
        where: {
          key: {
            in: [control.PREPROD_PAUSE_KEY, control.PREPROD_GENERATION_KEY],
          },
        },
      });
      for (const row of savedControl) {
        await prisma.syncMetadata.create({
          data: { ...row, lastSyncedAt: new Date() },
        });
      }
    });

    afterAll(() => vi.unstubAllEnvs());

    async function writeControl(pause: string, generation: string) {
      for (const [key, cursorId] of [
        [control.PREPROD_PAUSE_KEY, pause],
        [control.PREPROD_GENERATION_KEY, generation],
      ] as const) {
        await prisma.syncMetadata.upsert({
          where: { key },
          create: { key, cursorId, lastSyncedAt: new Date() },
          update: { cursorId },
        });
      }
    }

    /** A user (an admin, so Preprod access holds) with a bot in a room. */
    async function seed() {
      const userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          name: "Generation writer",
          email: `${userId}@example.test`,
          emailVerified: true,
          role: "admin",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      // The product's own creation path, so the workspace has its Files
      // vocabulary (`workspace-creation-chokepoint.test.ts`).
      const { id: workspaceId } = await createPersonalWorkspace(userId);
      const bot = await prisma.sokoBot.create({
        data: { userId, workspaceId },
      });
      const room = await prisma.chatRoom.create({
        data: {
          name: "Generation fixture",
          kind: "direct",
          directKey: `generation:${randomUUID()}`,
          createdByUserId: userId,
          userMembers: { create: { userId } },
          sokoBotMembers: { create: { sokoBotId: bot.id } },
        },
      });
      onTestFinished(async () => {
        const { DATABASE_SCHEMA_SHARED: shared, DATABASE_SCHEMA_MAINNET: net } =
          testSchemaNames();
        await prisma.$transaction(async (tx) => {
          // The legacy History trigger on Task still uses an unqualified name.
          if (onSplitLayout) {
            await tx.$executeRawUnsafe(
              `SET LOCAL search_path TO "${shared}", "${net}"`,
            );
          }
          await tx.chatRoom.delete({ where: { id: room.id } });
          await tx.task.deleteMany({ where: { workspaceId } });
          // The free plan `createPersonalWorkspace` grants is not tied to
          // the user.
          // The pause history names its operator without a relation.
          await tx.preprodAccessChange.deleteMany({
            where: { operatorId: userId },
          });
          await tx.subscription.deleteMany({ where: { referenceId: userId } });
          await tx.user.delete({ where: { id: userId } });
        });
      });
      caller.current = {
        actor: "user",
        authenticationMethod: "session",
        role: "admin",
        userId,
        organizationId: null,
      };
      return { userId, workspaceId, bot, roomId: room.id };
    }

    type Fixture = Awaited<ReturnType<typeof seed>>;

    function postMention({ roomId, bot }: Fixture, network?: "preprod") {
      return app.request(`/${roomId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(network ? { "X-Sokosumi-Network": network } : {}),
        },
        body: JSON.stringify({
          content: "Can you look at this?",
          mentionedSokoBotIds: [bot.id],
        }),
      });
    }

    function mentionsOf({ roomId }: Fixture) {
      return prisma.chatRoomMention.findMany({
        where: { message: { roomId } },
        select: { network: true, preprodGeneration: true },
      });
    }

    function schedule(
      { userId, workspaceId, bot }: Fixture,
      network: "mainnet" | "preprod",
    ) {
      return createSchedule({
        network,
        userId,
        workspaceId,
        sokoBotId: bot.id,
        name: `Schedule ${network}`,
        timezone: "UTC",
        cronExpression: "0 9 * * *",
        prompt: "Check in",
      });
    }

    function startTurn(
      { userId, workspaceId }: Fixture,
      network: "mainnet" | "preprod",
    ) {
      return controlPlane.startTurn({
        network,
        userId,
        workspaceId,
        clientTurnId: randomUUID(),
        message: "How is my board doing?",
        presetRoute: { route: "DIRECT_RESPONSE", reason: "Fixture" },
      });
    }

    function seedRuntimeTurn(
      { userId, workspaceId, bot }: Fixture,
      capabilityNames: SokoBotCapability[],
      network: "mainnet" | "preprod" = "mainnet",
      preprodGeneration?: number,
    ) {
      const future = new Date(Date.now() + 60_000);
      return prisma.sokoBotTurn.create({
        data: {
          network,
          preprodGeneration: preprodGeneration ?? null,
          sokoBotId: bot.id,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          userMessage: "Fixture turn",
          capabilityNames,
          deadlineAt: future,
          leaseExpiresAt: future,
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
      });
    }

    /** A `create_task` call in a running turn: the Task delegation writer. */
    async function taskDelegation(
      fixture: Fixture,
      network: "mainnet" | "preprod" = "mainnet",
      preprodGeneration?: number,
    ) {
      const turn = await seedRuntimeTurn(
        fixture,
        ["create_task"],
        network,
        preprodGeneration,
      );
      if (onSplitLayout) {
        const { DATABASE_SCHEMA_SHARED: shared, DATABASE_SCHEMA_MAINNET: net } =
          testSchemaNames();
        const serializable = transactions.serializableTransaction;
        vi.spyOn(transactions, "serializableTransaction").mockImplementation(
          (run, message, timing) =>
            serializable(
              async (tx) => {
                // The legacy History trigger still uses an unqualified name.
                await tx.$executeRawUnsafe(
                  `SET LOCAL search_path TO "${shared}", "${net}"`,
                );
                return run(tx);
              },
              message,
              timing,
            ),
        );
      }
      const toolCallId = randomUUID();
      const result = runtime.executeTool({
        sessionId: `session-${turn.id}`,
        turnId: turn.id,
        toolCallId,
        capability: "create_task",
        input: { name: "Fixture Task", status: "READY" },
      });
      return {
        result,
        read: () =>
          prisma.sokoBotDelegation.findFirst({
            where: { turnId: turn.id, toolCallId },
            select: { network: true, preprodGeneration: true },
          }),
      };
    }

    const KEYS = () => [
      control.PREPROD_PAUSE_KEY,
      control.PREPROD_GENERATION_KEY,
    ];

    it("writes Mainnet rows with no generation and reads neither control key", async () => {
      const fixture = await seed();
      // Open, so a read would find something to stamp.
      await writeControl("open", "3");
      const session = (
        await import("@/lib/soko-bot/factory")
      ).getSokoBotRuntime();
      vi.spyOn(session, "createSession").mockResolvedValue({
        sessionId: randomUUID(),
        runtimeVersion: "test",
        acceptedAt: new Date().toISOString(),
      });

      const recorded = recordStatements();
      let turnId: string | undefined;
      try {
        expect((await postMention(fixture)).status).toBe(201);
        await schedule(fixture, "mainnet");
        // Before the running fixture turn, which would hold the bot. On the
        // split layout classification and context still join Network tables
        // via the shared client (ticket 08).
        if (!onSplitLayout)
          turnId = (await startTurn(fixture, "mainnet")).turnId;
        const delegation = await taskDelegation(fixture);
        await delegation.result;
        await expect(delegation.read()).resolves.toEqual({
          network: "mainnet",
          preprodGeneration: null,
        });
      } finally {
        recorded.restore();
      }
      const keys = KEYS();
      expect(
        recorded.statements.filter((values) =>
          values.some((value) =>
            Array.isArray(value)
              ? value.some((item) => keys.includes(item))
              : keys.includes(value as string),
          ),
        ),
      ).toEqual([]);
      expect(recorded.statements.length).toBeGreaterThan(0);

      await expect(mentionsOf(fixture)).resolves.toEqual([
        { network: "mainnet", preprodGeneration: null },
      ]);
      await expect(
        prisma.sokoBotSchedule.findMany({
          where: { sokoBotId: fixture.bot.id, systemKey: null },
          select: { network: true, preprodGeneration: true },
        }),
      ).resolves.toEqual([{ network: "mainnet", preprodGeneration: null }]);
      if (turnId) {
        await expect(
          prisma.sokoBotTurn.findUniqueOrThrow({
            where: { id: turnId },
            select: { network: true, preprodGeneration: true },
          }),
        ).resolves.toEqual({ network: "mainnet", preprodGeneration: null });
      }
    });

    it.skipIf(onSplitLayout)(
      "skips the context credits payload when a disabled Preprod turn is refused",
      async () => {
        const fixture = await seed();
        await writeControl("paused", "3");
        // Turn funding is mocked here. This spy observes only the context packet.
        const credits = vi.spyOn(
          await import("@/lib/credits/funding"),
          "buildCreditsPayload",
        );
        await expect(startTurn(fixture, "preprod")).rejects.toThrow(
          "Preprod is off",
        );
        expect(credits).not.toHaveBeenCalled();
        await expect(
          prisma.sokoBotTurn.count({ where: { sokoBotId: fixture.bot.id } }),
        ).resolves.toBe(0);
      },
    );

    it.runIf(onSplitLayout).each(["mainnet", "preprod"] as const)(
      "known Preprod billing gap: a fresh turn checks Mainnet funding before disabled Preprod admission (only %s funded)",
      async (fundedNetwork) => {
        const fixture = await seed();
        const { userId, bot } = fixture;
        const scopes = await import("@/lib/db/network-scope");
        const wallets = {
          mainnet: scopes.createNetworkScope("mainnet").networkDb,
          preprod: scopes.createNetworkScope("preprod").networkDb,
        };
        const amount = 1_000_000_000_000_000n;
        const grant = await wallets[fundedNetwork].transaction.create({
          data: {
            userId,
            amount,
            sourceCreditBucket: { create: { userId, amount } },
          },
        });
        try {
          // Set up the distinct wallets first, then disable Preprod for the actual start.
          const env = await import("@/config/env");
          vi.spyOn(env, "getEnv").mockReturnValue({
            ...env.getEnv(),
            NETWORK_PREPROD_ENABLED: false,
          });
          const billing = await import("./soko-bot-billing.service");
          const realBilling = await vi.importActual<typeof billing>(
            "./soko-bot-billing.service",
          );
          vi.mocked(billing.requireSokoBotTurnFunding).mockImplementationOnce(
            realBilling.requireSokoBotTurnFunding,
          );
          const scopeCalls = vi.spyOn(scopes, "createNetworkScope");
          const recorded = recordStatements();
          try {
            const turn = startTurn(fixture, "preprod");
            if (fundedNetwork === "mainnet") {
              await expect(turn).rejects.toMatchObject({
                status: 500,
                message: expect.stringContaining("Preprod is off"),
              });
              expect(scopeCalls).toHaveBeenCalledWith("preprod");
            } else {
              await expect(turn).rejects.toBeInstanceOf(
                realBilling.SokoBotBillingAccessError,
              );
              await expect(turn).rejects.toMatchObject({
                reason: "credits",
                message:
                  "Insufficient personal credits to start a Soko Bot turn.",
              });
              expect(scopeCalls).not.toHaveBeenCalledWith("preprod");
            }
          } finally {
            recorded.restore();
          }
          const schema = testSchemaNames().DATABASE_SCHEMA_MAINNET;
          const reads = recorded.texts.filter((sql) =>
            sql.includes("AS balance"),
          );
          expect(reads).toHaveLength(1);
          expect(reads[0]).toContain(`FROM "${schema}"."credit_bucket"`);
          expect(reads[0]).toContain(`JOIN "${schema}"."credit_consumption"`);
          const balance = recorded.texts.indexOf(reads[0]);
          expect(recorded.statements[balance][0]).toBe(userId);
          await expect(
            prisma.sokoBotTurn.count({ where: { sokoBotId: bot.id } }),
          ).resolves.toBe(0);
          for (const [network, db] of Object.entries(wallets)) {
            await expect(
              db.transaction.findMany({
                where: { userId },
                select: { id: true, amount: true },
              }),
            ).resolves.toEqual(
              network === fundedNetwork ? [{ id: grant.id, amount }] : [],
            );
            await expect(
              db.creditBucket.findMany({
                where: { userId },
                select: {
                  amount: true,
                  consumptions: { select: { id: true } },
                },
              }),
            ).resolves.toEqual(
              network === fundedNetwork ? [{ amount, consumptions: [] }] : [],
            );
            await expect(
              db.sokoBotUsage.count({ where: { sokoBotId: bot.id } }),
            ).resolves.toBe(0);
          }
        } finally {
          await wallets[fundedNetwork].transaction.delete({
            where: { id: grant.id },
          });
        }
      },
    );

    // The turn insert stamps from its input alone. This public-layout fixture
    // bypasses admission and supplies public catalog tables. On the split
    // layout the classifier and packet still read Job and Project-to-Job
    // through the shared client (ticket 30).
    it.skipIf(onSplitLayout)(
      "stamps the current generation on a Preprod turn (on the split layout this waits for ticket 30: startTurn reads Job through the shared client)",
      async () => {
        const fixture = await seed();
        await writeControl("open", "3");
        const networkScopes = await import("@/lib/db/network-scope");
        const scope = networkScopes.createNetworkScope("mainnet");
        const startPreprodTurn = () => {
          // Bypass only this turn's Preprod catalog scope. Billing uses its real Mainnet scope.
          vi.spyOn(networkScopes, "createNetworkScope").mockImplementationOnce(
            (network) => {
              expect(network).toBe("preprod");
              return scope;
            },
          );
          return startTurn(fixture, "preprod");
        };
        const session = (
          await import("@/lib/soko-bot/factory")
        ).getSokoBotRuntime();
        vi.spyOn(session, "createSession").mockResolvedValue({
          sessionId: randomUUID(),
          runtimeVersion: "test",
          acceptedAt: new Date().toISOString(),
        });
        const { turnId } = await startPreprodTurn();
        await expect(
          prisma.sokoBotTurn.findUniqueOrThrow({
            where: { id: turnId },
            select: { network: true, preprodGeneration: true },
          }),
        ).resolves.toEqual({ network: "preprod", preprodGeneration: 3 });
        // Paused: no Preprod turn is reserved. The first one ends, so the bot
        // is free for the next start.
        await prisma.sokoBotTurn.update({
          where: { id: turnId },
          data: { status: "COMPLETED" },
        });
        await writeControl("paused", "3");
        await expect(startPreprodTurn()).rejects.toMatchObject({
          status: 503,
          cause: { kind: CORE_API_ERROR_KINDS.PREPROD_PAUSED },
        });
        await writeControl("open", "not a count");
        expectCoreLog(
          "error",
          "Could not read the Preprod pause and generation",
        );
        await expect(startPreprodTurn()).rejects.toMatchObject({
          status: 503,
          cause: { kind: CORE_API_ERROR_KINDS.PREPROD_CONTROL_UNAVAILABLE },
        });
        await expect(
          prisma.sokoBotTurn.count({ where: { sokoBotId: fixture.bot.id } }),
        ).resolves.toBe(1);
      },
    );

    async function seedHireApproval(fixture: Fixture, generation = 3) {
      const { userId, workspaceId, bot } = fixture;
      const turn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: bot.id,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          network: "preprod",
          preprodGeneration: generation,
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          deadlineAt: new Date(),
          userMessage: "Hire the Agent",
          capabilityNames: ["hire_agent"],
        },
      });
      const decision = await prisma.sokoBotPendingDecision.create({
        data: {
          turnId: turn.id,
          sokoBotId: bot.id,
          workspaceId,
          requestedByUserId: userId,
          toolName: "hire_agent",
          reason: "Fixture",
          status: "PROCESSING",
          proposal: {},
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      return { turn, decision };
    }

    it.skipIf(onSplitLayout)(
      "leaves an approval untouched when Preprod is off",
      async () => {
        const fixture = await seed();
        const { decision } = await seedHireApproval(fixture);
        await expect(
          runtime.resolveDecision(fixture.userId, decision.id, true),
        ).rejects.toMatchObject({ kind: "preprod_off", status: 403 });
        await expect(
          prisma.sokoBotPendingDecision.findUnique({
            where: { id: decision.id },
          }),
        ).resolves.toEqual(decision);
      },
    );

    it("expires an approval whose legacy turn has no Network", async () => {
      const fixture = await seed();
      const { turn, decision } = await seedHireApproval(fixture);
      await prisma.sokoBotTurn.update({
        where: { id: turn.id },
        data: { network: null, preprodGeneration: null },
      });

      await expect(
        runtime.resolveDecision(fixture.userId, decision.id, true),
      ).rejects.toMatchObject({ kind: "soko_bot_network_stale" });
      await expect(
        prisma.sokoBotPendingDecision.findUnique({
          where: { id: decision.id },
        }),
      ).resolves.toMatchObject({ status: "EXPIRED" });
      await expect(
        prisma.sokoBotToolCall.count({ where: { turnId: turn.id } }),
      ).resolves.toBe(0);
    });

    async function seedWatch(
      fixture: Fixture,
      network: "mainnet" | "preprod",
      count: number,
      createdAt: Date,
    ) {
      const turn = await prisma.sokoBotTurn.create({
        data: {
          network,
          preprodGeneration: network === "preprod" ? 3 : null,
          sokoBotId: fixture.bot.id,
          workspaceId: fixture.workspaceId,
          requestedByUserId: fixture.userId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          userMessage: "Tell me when I connect the app",
          deadlineAt: new Date(),
          capabilityNames: [],
        },
      });
      await prisma.sokoBotWatch.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          sokoBotId: fixture.bot.id,
          turnId: turn.id,
          kind: "app_connected",
          targetId: `fixture-${index}`,
          then: "Tell me",
          createdAt,
          expiresAt: new Date(Date.now() - 1_000),
        })),
      });
      return turn.id;
    }

    it.each(onSplitLayout ? ["paused", "unavailable"] : ["off"])(
      "expires Mainnet before 50 older Preprod watches while Preprod is %s",
      async (state) => {
        const { syncSokoBotWatches } = await import(
          "./soko-bot-watches.service"
        );
        await writeControl(
          state === "paused" ? "paused" : "open",
          state === "unavailable" ? "invalid" : "3",
        );
        const mainnet = await seed();
        const tick = () => syncSokoBotWatches({ shouldContinue: () => true });
        const newer = new Date(Date.now() - 60_000);
        await seedWatch(mainnet, "mainnet", 1, newer);
        const recorder = recordStatements();
        try {
          await expect(tick()).resolves.toMatchObject({
            checked: 1,
            deferred: 0,
            failed: 0,
          });
        } finally {
          recorder.restore();
        }
        expect(recorder.statements).toHaveLength(5);
        for (const key of KEYS())
          expect(recorder.statements.flat()).not.toContain(key);

        const preprod = await seed();
        const ahead = await seedWatch(
          preprod,
          "preprod",
          50,
          new Date(Date.now() - 3_600_000),
        );
        const after = await seedWatch(mainnet, "mainnet", 1, newer);
        if (state === "unavailable") {
          expectCoreLog(
            "error",
            "Could not read the Preprod pause and generation",
            1,
          );
        }
        const mixed = recordStatements();
        try {
          await expect(tick()).resolves.toMatchObject({
            checked: 50,
            deferred: 49,
            failed: 0,
          });
        } finally {
          mixed.restore();
        }
        expect(
          mixed.texts.filter((text) => text.includes("sync_metadata")),
        ).toHaveLength(state === "off" ? 0 : 1);
        await expect(
          prisma.sokoBotWatch.count({
            where: { turnId: after, status: "EXPIRED" },
          }),
        ).resolves.toBe(1);
        await expect(
          prisma.sokoBotWatch.count({
            where: { turnId: ahead, status: "WAITING", outcome: null },
          }),
        ).resolves.toBe(50);
      },
    );

    it.skipIf(onSplitLayout)(
      "refuses derived stamps when Preprod is off",
      async () => {
        await writeControl("open", "3");
        await expect(
          prisma.$transaction((tx) =>
            control.networkStamp(
              {
                network: "preprod",
                expectedPreprodGeneration: 3,
              },
              tx,
            ),
          ),
        ).rejects.toMatchObject({ kind: "preprod_off", status: 403 });
      },
    );

    describe.runIf(onSplitLayout)("Preprod on the split layout", () => {
      it("stamps the current generation on a Preprod mention, schedule and delegation", async () => {
        const fixture = await seed();
        await writeControl("open", "3");

        expect((await postMention(fixture, "preprod")).status).toBe(201);
        await expect(mentionsOf(fixture)).resolves.toEqual([
          { network: "preprod", preprodGeneration: 3 },
        ]);
        await expect(schedule(fixture, "preprod")).resolves.toMatchObject({
          network: "preprod",
          preprodGeneration: 3,
        });
        const delegation = await taskDelegation(fixture, "preprod", 3);
        await delegation.result;
        await expect(delegation.read()).resolves.toEqual({
          network: "preprod",
          preprodGeneration: 3,
        });
      });

      async function seedApproval(fixture: Fixture, generation = 3) {
        const { userId, workspaceId } = fixture;
        const { turn, decision } = await seedHireApproval(fixture, generation);
        const { createNetworkScope } = await import("@/lib/db/network-scope");
        const preprod = createNetworkScope("preprod").networkDb;
        const mainnet = createNetworkScope("mainnet").networkDb;
        const jobId = randomUUID();
        const makeJob = async (db: typeof preprod, ownerId: string | null) => {
          const agent = await db.agent.create({
            data: {
              blockchainIdentifier: randomUUID(),
              name: "Fixture Agent",
              isShown: true,
              lastUptimeCheck: new Date(),
              uptimeCount: 1,
              uptimeCheckCount: 1,
              pricing: { create: { pricingType: "FREE" } },
            },
          });
          onTestFinished(async () => {
            await db.job.deleteMany({ where: { agentId: agent.id } });
            await db.agent.delete({ where: { id: agent.id } });
            await db.agentPricing.delete({ where: { id: agent.pricingId } });
          });
          return db.job.create({
            data: {
              id: jobId,
              ownerId,
              workspaceId,
              agentId: agent.id,
              agentJobId: randomUUID(),
              jobType: "FREE",
            },
          });
        };
        // The split fixture still has the legacy Mainnet Job FK. A same-ID
        // placeholder satisfies it but cannot be recovered for this owner.
        const mainnetJob = await makeJob(mainnet, null);
        const job = await makeJob(preprod, userId);
        const receiptKey = {
          turnId: turn.id,
          toolCallId: `decision:${decision.id}`,
        };
        const reservation = await prisma.sokoBotDelegation.create({
          data: {
            ...receiptKey,
            kind: "JOB",
            action: "hire_agent",
            outcome: "processing",
            network: "preprod",
            preprodGeneration: generation,
            jobId: job.id,
          },
        });
        return {
          decision,
          job,
          mainnetJob,
          preprod,
          mainnet,
          reservation,
          resolve: () => runtime.resolveDecision(userId, decision.id, true),
          readDecision: () =>
            prisma.sokoBotPendingDecision.findUniqueOrThrow({
              where: { id: decision.id },
            }),
          receipts: () => prisma.sokoBotToolCall.count({ where: receiptKey }),
        };
      }

      it("replays a durable Preprod Job reservation using only Preprod Job data", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        await expect(approval.resolve()).resolves.toMatchObject({
          status: "ACCEPTED",
          resultingEntityId: approval.job.id,
        });
        await expect(approval.receipts()).resolves.toBe(1);
        await expect(
          approval.mainnet.job.findUnique({
            where: { id: approval.job.id },
          }),
        ).resolves.toEqual(approval.mainnetJob);
        await expect(
          approval.mainnet.transaction.count({
            where: { userId: approval.job.ownerId, amount: { lt: 0n } },
          }),
        ).resolves.toBe(0);
        await expect(
          prisma.sokoBotDelegation.findUnique({
            where: { id: approval.reservation.id },
          }),
        ).resolves.toMatchObject({
          outcome: "accepted",
          network: "preprod",
          preprodGeneration: 3,
        });
      });

      it.each([
        ["paused", "4", "soko_bot_network_stale", true],
        ["open", "invalid", "preprod_control_unavailable", false],
      ] as const)(
        "classifies a derived stamp while %s at generation %s",
        async (pause, generation, kind, final) => {
          const { DetachedNetworkRefusal } = await import(
            "@/lib/soko-bot/detached-network"
          );
          await writeControl(pause, generation);
          if (!final)
            expectCoreLog(
              "error",
              "Could not read the Preprod pause and generation",
              1,
            );
          const stamp = prisma.$transaction((tx) =>
            control.networkStamp(
              {
                network: "preprod",
                expectedPreprodGeneration: 3,
              },
              tx,
            ),
          );
          await expect(stamp).rejects.toBeInstanceOf(DetachedNetworkRefusal);
          await expect(stamp).rejects.toMatchObject({ kind, final });
        },
      );

      it("rejects replay after the reservation outcome changes", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        const serializable = transactions.serializableTransaction;
        vi.spyOn(
          transactions,
          "serializableTransaction",
        ).mockImplementationOnce(async (run, message, timing) => {
          await prisma.sokoBotDelegation.update({
            where: { id: approval.reservation.id },
            data: { outcome: "ambiguous" },
          });
          return serializable(run, message, timing);
        });

        await expect(approval.resolve()).rejects.toThrow(
          "Soko Bot reservation changed during recovery",
        );
        await expect(approval.readDecision()).resolves.toMatchObject({
          status: "PROCESSING",
        });
        await expect(approval.receipts()).resolves.toBe(0);
        await expect(
          prisma.sokoBotDelegation.findUnique({
            where: { id: approval.reservation.id },
          }),
        ).resolves.toMatchObject({ outcome: "ambiguous" });
      });

      it("checks a derived schedule's Job in Preprod", async () => {
        await writeControl("open", "3");
        const fixture = await seed();
        const other = await seed();
        const approval = await seedApproval(fixture);
        await approval.mainnet.job.update({
          where: { id: approval.job.id },
          data: { workspaceId: other.workspaceId },
        });
        const run = () =>
          prisma.$transaction(
            (tx) =>
              createSchedule(
                {
                  network: "preprod",
                  expectedPreprodGeneration: 3,
                  userId: fixture.userId,
                  workspaceId: fixture.workspaceId,
                  sokoBotId: fixture.bot.id,
                  jobId: approval.job.id,
                  name: "Watch the Preprod Job",
                  timezone: "UTC",
                  cronExpression: "0 9 * * *",
                  prompt: "Check in",
                },
                tx,
              ),
            { isolationLevel: "Serializable" },
          );
        const recorder = recordStatements();
        try {
          await expect(run()).resolves.toMatchObject({
            network: "preprod",
            preprodGeneration: 3,
            jobId: approval.job.id,
          });
        } finally {
          recorder.restore();
        }
        expect(recorder.checkouts).toHaveLength(1);
        const stamp = recorder.texts.findIndex((text) =>
          text.includes("FOR SHARE"),
        );
        const job = recorder.texts.findIndex((text) =>
          text.includes('"preprod"."Job"'),
        );
        expect(stamp).toBeGreaterThanOrEqual(0);
        expect(job).toBeGreaterThan(stamp);

        await writeControl("paused", "3");
        const refused = recordStatements();
        try {
          await expect(run()).rejects.toMatchObject({ kind: "preprod_paused" });
        } finally {
          refused.restore();
        }
        expect(refused.checkouts).toHaveLength(1);
        expect(
          refused.texts.some((text) => text.includes('"preprod"."Job"')),
        ).toBe(false);
      });

      it("wakes a connected Preprod watch with its original generation", async () => {
        const { syncSokoBotWatches } = await import(
          "./soko-bot-watches.service"
        );
        const fixture = await seed();
        const turnId = await seedWatch(
          fixture,
          "preprod",
          1,
          new Date(Date.now() - 60_000),
        );
        await prisma.sokoBotIntegration.create({
          data: {
            sokoBotId: fixture.bot.id,
            provider: "fixture-0",
            status: "ACTIVE",
            composioAccountId: randomUUID(),
          },
        });
        const start = vi.spyOn(controlPlane, "startTurn").mockResolvedValue({
          turnId,
          sokoBotId: fixture.bot.id,
          sessionId: "watch-fixture",
          status: "RUNNING",
          route: "DELEGATE_TASK",
          capabilities: [],
          duplicate: false,
        });
        const tick = () => syncSokoBotWatches({ shouldContinue: () => true });
        await writeControl("paused", "3");
        await expect(tick()).resolves.toMatchObject({ deferred: 1, fired: 0 });
        expect(start).not.toHaveBeenCalled();

        await writeControl("open", "3");
        await expect(tick()).resolves.toMatchObject({ fired: 1 });
        expect(start).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            network: "preprod",
            expectedPreprodGeneration: 3,
            source: "CHAT",
          }),
        );
      });

      it("passes the failed Preprod turn's generation to admin retry", async () => {
        const { failedRetryInput } = await import(
          "./soko-bot-admin-retry.service"
        );
        await writeControl("open", "3");
        const fixture = await seed();
        const { turn } = await seedHireApproval(fixture);
        const failed = await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: { status: "FAILED" },
        });
        await expect(
          failedRetryInput(fixture.bot, failed, "retry-fixture"),
        ).resolves.toMatchObject({
          network: "preprod",
          expectedPreprodGeneration: 3,
        });
      });

      it("stamps a mention posted by a Preprod runtime turn", async () => {
        await writeControl("open", "3");
        const fixture = await seed();
        const peer = await prisma.sokoBot.create({
          data: {
            userId: null,
            workspaceId: fixture.workspaceId,
            name: "HelperBot",
          },
        });
        await prisma.chatRoomSokoBotMember.create({
          data: { roomId: fixture.roomId, sokoBotId: peer.id },
        });
        const turn = await seedRuntimeTurn(
          fixture,
          ["post_chat"],
          "preprod",
          3,
        );
        await expect(
          runtime.executeTool({
            sessionId: `session-${turn.id}`,
            turnId: turn.id,
            toolCallId: randomUUID(),
            capability: "post_chat",
            input: {
              roomId: fixture.roomId,
              content: "Hey @HelperBot please check this",
            },
          }),
        ).resolves.toMatchObject({ queuedMentions: 1 });
        await expect(mentionsOf(fixture)).resolves.toEqual([
          { network: "preprod", preprodGeneration: 3 },
        ]);
      });

      it.each([
        ["paused", "3", "preprod_paused", "PROCESSING"],
        ["paused", "4", "soko_bot_network_stale", "EXPIRED"],
      ] as const)(
        "settles a resumed Task approval refused after admission at generation %s/%s",
        async (pause, generation, kind, status) => {
          const { prepareDecision } = await import(
            "./soko-bot-runtime/decision-claim"
          );
          const { applyDecision } = await import(
            "./soko-bot-runtime/decision-apply"
          );
          await writeControl("open", "3");
          const fixture = await seed();
          const { turn, decision } = await seedHireApproval(fixture);
          await prisma.sokoBotTurn.update({
            where: { id: turn.id },
            data: { capabilityNames: ["create_task"] },
          });
          const taskName = "Task refused after admission";
          await prisma.sokoBotPendingDecision.update({
            where: { id: decision.id },
            data: {
              toolName: "create_task",
              proposal: { name: taskName, status: "READY" },
            },
          });
          const operations = runtime["operations"];
          const prepared = await prepareDecision(
            operations,
            fixture.userId,
            decision.id,
            true,
            true,
          );
          if (prepared.done)
            throw new Error("The approval should be ready to apply");
          expect(prepared.resumeProcessing).toBe(true);

          await writeControl(pause, generation);
          await expect(
            applyDecision(operations, prepared),
          ).rejects.toMatchObject({ kind });
          await expect(
            prisma.sokoBotPendingDecision.findUnique({
              where: { id: decision.id },
            }),
          ).resolves.toMatchObject({ status });
          await expect(
            prisma.task.count({
              where: { workspaceId: fixture.workspaceId, name: taskName },
            }),
          ).resolves.toBe(0);
          await expect(
            prisma.sokoBotToolCall.count({ where: { turnId: turn.id } }),
          ).resolves.toBe(0);
        },
      );

      it("keeps the admin failed-turn retry open while Preprod is paused", async () => {
        await writeControl("paused", "3");
        const fixture = await seed();
        const { turn } = await seedHireApproval(fixture);
        await prisma.sokoBotTurn.update({
          where: { id: turn.id },
          data: { status: "FAILED" },
        });
        const operationId = randomUUID();
        const retry = () =>
          controlPlane.performAdminAction({
            sokoBotId: fixture.bot.id,
            operatorId: fixture.userId,
            action: "RETRY_LAST_FAILED",
            operationId,
            reason: "Retry test",
          });
        const statuses = () =>
          prisma.sokoBotAdminAction.findMany({
            where: { operationId },
            select: { status: true },
          });
        await expect(retry()).rejects.toMatchObject({ kind: "preprod_paused" });
        await expect(retry()).rejects.toMatchObject({ kind: "preprod_paused" });
        await expect(statuses()).resolves.toEqual([{ status: "ATTEMPTED" }]);
        await writeControl("paused", "4");
        await expect(retry()).rejects.toMatchObject({
          kind: "soko_bot_network_stale",
        });
        await expect(statuses()).resolves.toEqual(
          expect.arrayContaining([
            { status: "ATTEMPTED" },
            { status: "FAILED" },
          ]),
        );
        await expect(
          prisma.sokoBotTurn.count({ where: { sokoBotId: fixture.bot.id } }),
        ).resolves.toBe(1);
      });

      it("recovers Job input from the turn's Preprod schema", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        const event = await approval.preprod.jobEvent.create({
          data: {
            jobId: approval.job.id,
            status: "AWAITING_INPUT",
            input: { create: { input: "{}" } },
          },
          include: { input: true },
        });
        await prisma.sokoBotPendingDecision.update({
          where: { id: approval.decision.id },
          data: {
            toolName: "provide_job_input",
            proposal: {
              jobId: approval.job.id,
              eventId: event.id,
              inputData: {},
            },
          },
        });
        await prisma.sokoBotDelegation.update({
          where: { id: approval.reservation.id },
          data: { action: "provide_job_input" },
        });
        expect(event.input?.id).toBeTruthy();
        await expect(approval.resolve()).resolves.toMatchObject({
          status: "ACCEPTED",
          resultingEntityId: event.input?.id,
        });
        await expect(approval.receipts()).resolves.toBe(1);
      });

      it("expires a reservation whose Job exists only in Mainnet", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        await approval.preprod.job.delete({ where: { id: approval.job.id } });
        await expect(approval.resolve()).rejects.toMatchObject({
          kind: "soko_bot_network_stale",
        });
        await expect(approval.readDecision()).resolves.toMatchObject({
          status: "EXPIRED",
        });
        await expect(approval.receipts()).resolves.toBe(0);
      });

      it.each([
        ["paused", "3", "preprod_paused", "PROCESSING"],
        ["paused", "4", "soko_bot_network_stale", "EXPIRED"],
        ["open", "invalid", "preprod_control_unavailable", "PROCESSING"],
      ] as const)(
        "refuses approval replay while %s at generation %s",
        async (pause, generation, kind, status) => {
          const approval = await seedApproval(await seed());
          await writeControl(pause, generation);
          if (kind === "preprod_control_unavailable") {
            expectCoreLog(
              "error",
              "Could not read the Preprod pause and generation",
              1,
            );
          }
          await expect(approval.resolve()).rejects.toMatchObject({ kind });
          await expect(approval.readDecision()).resolves.toMatchObject({
            status,
          });
          await expect(approval.receipts()).resolves.toBe(0);
          await expect(
            prisma.sokoBotDelegation.findUnique({
              where: { id: approval.reservation.id },
            }),
          ).resolves.toEqual(approval.reservation);
        },
      );

      it("expires a Preprod approval for a reservation from a different Network", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        await prisma.sokoBotDelegation.update({
          where: { id: approval.reservation.id },
          data: { network: "mainnet", preprodGeneration: null },
        });
        await expect(approval.resolve()).rejects.toMatchObject({
          kind: "soko_bot_network_stale",
        });
        await expect(approval.readDecision()).resolves.toMatchObject({
          status: "EXPIRED",
        });
        await expect(approval.receipts()).resolves.toBe(0);
      });

      it("leaves a Preprod hire awaiting approval until a scoped seller is available", async () => {
        await writeControl("open", "3");
        const approval = await seedApproval(await seed());
        await prisma.sokoBotPendingDecision.update({
          where: { id: approval.decision.id },
          data: { status: "PENDING" },
        });
        await prisma.sokoBotDelegation.delete({
          where: { id: approval.reservation.id },
        });
        await expect(approval.resolve()).rejects.toMatchObject({ status: 503 });
        await expect(approval.readDecision()).resolves.toMatchObject({
          status: "PENDING",
        });
        await expect(approval.receipts()).resolves.toBe(0);
      });

      it.each([
        ["paused", "paused", "3"],
        ["unavailable", "open", "not a count"],
      ])(
        "writes no Preprod row while Preprod is %s",
        async (_state, pause, generation) => {
          const fixture = await seed();
          await writeControl(pause, generation);
          if (generation !== "3") {
            // Each refused write read the control once and found no count.
            expectCoreLog(
              "error",
              "Could not read the Preprod pause and generation",
              2,
            );
          }

          expect((await postMention(fixture, "preprod")).status).toBe(503);
          await expect(
            prisma.chatRoomMessage.count({ where: { roomId: fixture.roomId } }),
          ).resolves.toBe(0);
          const refusal = await schedule(fixture, "preprod").catch(
            (error: unknown) => error,
          );
          expect(refusal).toBeInstanceOf(HTTPException);
          expect((refusal as HTTPException).status).toBe(503);
          // Planned: the error handler sends no Sentry Issue for it.
          expect(shouldReportHttpException(refusal as HTTPException)).toBe(
            false,
          );
          await expect(
            prisma.sokoBotSchedule.count({
              where: { sokoBotId: fixture.bot.id, systemKey: null },
            }),
          ).resolves.toBe(0);
          // A Mainnet mention in the same room is not held up.
          expect((await postMention(fixture)).status).toBe(201);
        },
      );

      /** Sessions of this database waiting on a lock. */
      async function untilWaiting(count: number) {
        for (let attempt = 0; attempt < 500; attempt += 1) {
          const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database()
              AND cardinality(pg_blocking_pids(pid)) > 0`;
          if ((row?.waiting ?? 0) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Fewer than ${count} sessions waited on a lock`);
      }

      /**
       * A second session holding `lock` until `release`: the first session's
       * write waits behind it.
       */
      async function holdOpen(
        lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) {
        let locked!: () => void;
        const isLocked = new Promise<void>((resolve) => {
          locked = resolve;
        });
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = prisma.$transaction(
          async (tx) => {
            await lock(tx);
            locked();
            await released;
          },
          { timeout: 30_000 },
        );
        await Promise.race([isLocked, holder]);
        return async () => {
          release();
          await holder;
        };
      }

      it.each(["pause", "raise"] as const)(
        "orders %s against replay at the existing stamp",
        async (operation) => {
          const fixture = await seed();
          await writeControl("open", "3");
          const loses = await seedApproval(fixture);
          const wins = await seedApproval(fixture);
          const change = async (tx: Prisma.TransactionClient) => {
            await tx.syncMetadata.update({
              where: { key: control.PREPROD_PAUSE_KEY },
              data: { cursorId: operation === "pause" ? "paused" : "open" },
            });
            if (operation === "raise") {
              await tx.syncMetadata.update({
                where: { key: control.PREPROD_GENERATION_KEY },
                data: { cursorId: "4" },
              });
            }
          };
          const releaseOperator = await holdOpen(change);
          const refused = expect(loses.resolve()).rejects.toMatchObject({
            kind:
              operation === "pause"
                ? "preprod_paused"
                : "soko_bot_network_stale",
          });
          try {
            await untilWaiting(1);
          } finally {
            await releaseOperator();
          }
          await refused;
          await expect(loses.receipts()).resolves.toBe(0);
          await expect(loses.readDecision()).resolves.toMatchObject({
            status: operation === "pause" ? "PROCESSING" : "EXPIRED",
          });

          await writeControl("open", "3");
          const releaseInsert = await holdOpen(
            (tx) =>
              tx.$executeRaw`LOCK TABLE ${sharedTable("soko_bot_delegation")} IN SHARE MODE`,
          );
          const accepted = expect(wins.resolve()).resolves.toMatchObject({
            status: "ACCEPTED",
          });
          try {
            await untilWaiting(1);
            const changed =
              operation === "pause"
                ? control.setPreprodPaused({
                    paused: true,
                    operatorId: fixture.userId,
                    reason: "Race fixture",
                  })
                : control.raisePreprodGeneration();
            try {
              await untilWaiting(2);
            } finally {
              await releaseInsert();
            }
            await changed;
          } catch (error) {
            await releaseInsert();
            throw error;
          }
          await accepted;
          await expect(wins.receipts()).resolves.toBe(1);
        },
        30_000,
      );

      /** Holds back the schedule INSERT, after its stamp read the control. */
      const holdScheduleInserts = () =>
        holdOpen(
          (tx) =>
            tx.$executeRaw`LOCK TABLE ${sharedTable("soko_bot_schedule")} IN SHARE MODE`,
        );

      it("lets a pause wait for a Preprod row being written, which keeps the generation it read", async () => {
        const fixture = await seed();
        await writeControl("open", "3");
        const release = await holdScheduleInserts();
        const creating = schedule(fixture, "preprod");
        void creating.catch(() => {});
        await untilWaiting(1);
        const pausing = control.setPreprodPaused({
          paused: true,
          operatorId: fixture.userId,
          reason: "Pause during a write",
        });
        void pausing.catch(() => {});
        // The pause waits for the row's lock on the control.
        await untilWaiting(2);
        await release();
        await expect(creating).resolves.toMatchObject({
          network: "preprod",
          preprodGeneration: 3,
        });
        await expect(pausing).resolves.toMatchObject({ paused: true });
      });

      it("refuses a Preprod row once a pause in flight commits", async () => {
        const fixture = await seed();
        await writeControl("open", "3");
        // The pause's own statements, held before their commit.
        const release = await holdOpen(async (tx) => {
          await tx.$queryRaw`
            SELECT 1 FROM ${sharedTable("sync_metadata")}
            WHERE "key" = ${control.PREPROD_PAUSE_KEY} FOR UPDATE`;
          await tx.syncMetadata.update({
            where: { key: control.PREPROD_PAUSE_KEY },
            data: { cursorId: "paused" },
          });
        });
        const creating = schedule(fixture, "preprod");
        void creating.catch(() => {});
        await untilWaiting(1);
        await release();
        await expect(creating).rejects.toMatchObject({ status: 503 });
        await expect(
          prisma.sokoBotSchedule.count({
            where: { sokoBotId: fixture.bot.id, systemKey: null },
          }),
        ).resolves.toBe(0);
      });

      it.each([
        ["a raise", "3", 3, 4],
        // No generation row to lock yet: only the pause row orders them.
        ["the first raise", null, 0, 1],
      ] as const)(
        "lets %s wait for a Preprod row being written",
        async (_raise, stored, read, raised) => {
          const fixture = await seed();
          await writeControl("open", stored ?? "0");
          if (stored === null) {
            await prisma.syncMetadata.delete({
              where: { key: control.PREPROD_GENERATION_KEY },
            });
          }
          const release = await holdScheduleInserts();
          const creating = schedule(fixture, "preprod");
          void creating.catch(() => {});
          await untilWaiting(1);
          const raising = control.raisePreprodGeneration();
          void raising.catch(() => {});
          await untilWaiting(2);
          await release();
          await expect(creating).resolves.toMatchObject({
            preprodGeneration: read,
          });
          await expect(raising).resolves.toBe(raised);
        },
      );

      class RolledBack extends Error {}

      /**
       * Like `holdOpen`, but the second session rolls back on release: an
       * uncommitted generation row holds a raise at its upsert, after its
       * fence, and leaves no row behind.
       */
      async function holdRaiseAtUpsert() {
        let locked!: () => void;
        const isLocked = new Promise<void>((resolve) => {
          locked = resolve;
        });
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = prisma.$transaction(
          async (tx) => {
            await tx.syncMetadata.create({
              data: {
                key: control.PREPROD_GENERATION_KEY,
                cursorId: "9",
                lastSyncedAt: new Date(),
              },
            });
            locked();
            await released;
            throw new RolledBack();
          },
          { timeout: 30_000 },
        );
        await Promise.race([isLocked, holder]);
        return async () => {
          release();
          await holder.catch((error: unknown) => {
            if (!(error instanceof RolledBack)) throw error;
          });
        };
      }

      /** Preprod open, with no generation row yet: generation 0. */
      async function openWithoutGeneration() {
        await writeControl("open", "0");
        await prisma.syncMetadata.delete({
          where: { key: control.PREPROD_GENERATION_KEY },
        });
      }

      // The two isolation levels a Preprod writer uses: the schedule's
      // serializable transaction and the message POST's Read Committed one.
      const WRITERS = {
        serializable: {
          hold: () => holdScheduleInserts(),
          write: async (fixture: Fixture) =>
            (await schedule(fixture, "preprod")).preprodGeneration,
        },
        "Read Committed": {
          hold: () =>
            holdOpen(
              (tx) =>
                tx.$executeRaw`LOCK TABLE ${sharedTable("chat_room_mention")} IN SHARE MODE`,
            ),
          write: async (fixture: Fixture) => {
            expect((await postMention(fixture, "preprod")).status).toBe(201);
            const [mention] = await mentionsOf(fixture);
            return mention?.preprodGeneration;
          },
        },
      } as const;

      it.each(["serializable", "Read Committed"] as const)(
        "orders a %s writer and the first raise, the writer first",
        async (kind) => {
          const fixture = await seed();
          await openWithoutGeneration();
          const writer = WRITERS[kind];
          const release = await writer.hold();
          const writing = writer.write(fixture);
          void writing.catch(() => {});
          await untilWaiting(1);
          const raising = control.raisePreprodGeneration();
          void raising.catch(() => {});
          // The raise waits for the writer's lock on the pause row.
          await untilWaiting(2);
          await release();
          await expect(writing).resolves.toBe(0);
          await expect(raising).resolves.toBe(1);
        },
      );

      it.each(["serializable", "Read Committed"] as const)(
        "orders a %s writer and the first raise, the raise first",
        async (kind) => {
          const fixture = await seed();
          await openWithoutGeneration();
          const release = await holdRaiseAtUpsert();
          const raising = control.raisePreprodGeneration();
          void raising.catch(() => {});
          await untilWaiting(1);
          const writing = WRITERS[kind].write(fixture);
          void writing.catch(() => {});
          // The writer waits for the raise's update of the pause row.
          await untilWaiting(2);
          await release();
          await expect(raising).resolves.toBe(1);
          await expect(writing).resolves.toBe(1);
        },
      );

      it("creates a missing pause row as paused for a raise and an open, and the raise's no-op changes nothing the admin read shows", async () => {
        const fixture = await seed();
        const keys = [
          control.PREPROD_PAUSE_KEY,
          control.PREPROD_GENERATION_KEY,
        ];
        await prisma.syncMetadata.deleteMany({ where: { key: { in: keys } } });
        const { changes: history } = await control.preprodControlOf(prisma);
        await expect(control.raisePreprodGeneration()).resolves.toBe(1);
        await expect(control.preprodControlOf(prisma)).resolves.toEqual({
          paused: true,
          generation: 1,
          changes: history,
        });
        await expect(schedule(fixture, "preprod")).rejects.toMatchObject({
          status: 503,
        });

        await prisma.syncMetadata.deleteMany({ where: { key: { in: keys } } });
        const opened = await control.setPreprodPaused({
          paused: false,
          operatorId: fixture.userId,
          reason: "Open with no row",
        });
        expect(opened).toMatchObject({ paused: false, generation: 0 });
        expect(opened.changes).toHaveLength(history.length + 1);

        const pauseRow = () =>
          prisma.syncMetadata.findUniqueOrThrow({
            where: { key: control.PREPROD_PAUSE_KEY },
          });
        const before = await pauseRow();
        await expect(control.raisePreprodGeneration()).resolves.toBe(1);
        expect(await pauseRow()).toEqual(before);
        await expect(control.preprodControlOf(prisma)).resolves.toEqual({
          ...opened,
          generation: 1,
        });
      });

      it("completes a raise and a writer without a deadlock when the generation row comes first in the heap", async () => {
        const fixture = await seed();
        const keys = [
          control.PREPROD_PAUSE_KEY,
          control.PREPROD_GENERATION_KEY,
        ];
        await prisma.syncMetadata.deleteMany({ where: { key: { in: keys } } });
        // Generation first, then pause: a scan meets them in this order.
        for (const [key, cursorId] of [
          [control.PREPROD_GENERATION_KEY, "3"],
          [control.PREPROD_PAUSE_KEY, "open"],
        ] as const) {
          await prisma.syncMetadata.create({
            data: { key, cursorId, lastSyncedAt: new Date() },
          });
        }
        // Holds the raise after its fence, at the generation row.
        const release = await holdOpen(
          (tx) => tx.$queryRaw`
            SELECT 1 FROM ${sharedTable("sync_metadata")}
            WHERE "key" = ${control.PREPROD_GENERATION_KEY} FOR UPDATE`,
        );
        const raising = control.raisePreprodGeneration();
        void raising.catch(() => {});
        await untilWaiting(1);
        const writing = schedule(fixture, "preprod");
        void writing.catch(() => {});
        await untilWaiting(2);
        await release();
        await expect(raising).resolves.toBe(4);
        await expect(writing).resolves.toMatchObject({ preprodGeneration: 4 });
      });

      it("answers 503 for a control read that fails, and recorded once", async () => {
        await writeControl("open", "3");
        expectCoreLog(
          "error",
          "Could not read the Preprod pause and generation",
        );
        const release = await holdOpen(
          (tx) =>
            tx.$executeRaw`LOCK TABLE ${sharedTable("sync_metadata")} IN ACCESS EXCLUSIVE MODE`,
        );
        try {
          const refusal = await prisma
            .$transaction(async (tx) => {
              await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
              return control.networkStamp("preprod", tx);
            })
            .catch((error: unknown) => error);
          expect(refusal).toBeInstanceOf(HTTPException);
          expect((refusal as HTTPException).status).toBe(503);
          expect(shouldReportHttpException(refusal as HTTPException)).toBe(
            false,
          );
        } finally {
          await release();
        }
      });

      it("hands a serialization failure in the control read to the caller's retry", async () => {
        await writeControl("open", "3");
        let attempts = 0;
        const stamp = await transactions.serializableTransaction(async (tx) => {
          attempts += 1;
          // The snapshot is taken here, before the raise commits.
          await tx.$queryRaw`SELECT 1`;
          if (attempts === 1) await control.raisePreprodGeneration();
          return control.networkStamp("preprod", tx);
        }, "Stamp retried");
        expect(attempts).toBe(2);
        expect(stamp).toEqual({ network: "preprod", preprodGeneration: 4 });
      });
    });
  },
);
