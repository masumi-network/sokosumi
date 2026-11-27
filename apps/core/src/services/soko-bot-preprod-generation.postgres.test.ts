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
import type { SokoBotCapability } from "@sokosumi/soko-bot";
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

import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const { detached, caller } = vi.hoisted(() => ({
  /** The detached Network the runtime's delegation writers pass. */
  detached: { network: "mainnet" as "mainnet" | "preprod" },
  /** The request's caller, set before the Network scope is built. */
  caller: { current: undefined as unknown },
}));
vi.mock("@/lib/network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network")>();
  return {
    ...actual,
    get DETACHED_SOKO_BOT_NETWORK() {
      return detached.network;
    },
  };
});
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
      detached.network = "mainnet";
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
      const { id: workspaceId } = await prisma.workspace.create({
        data: { userId },
      });
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

    /** A `create_task` call in a running turn: the Task delegation writer. */
    async function taskDelegation({ userId, workspaceId, bot }: Fixture) {
      const capabilityNames: SokoBotCapability[] = ["create_task"];
      const future = new Date(Date.now() + 60_000);
      const turn = await prisma.sokoBotTurn.create({
        data: {
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

    // The turn insert stamps from its input alone, which needs no Preprod
    // flag. On the split layout the classifier and the context packet still
    // read Agent, Job and Project-to-Job through the shared client (ticket 30).
    it.skipIf(onSplitLayout)(
      "stamps the current generation on a Preprod turn",
      async () => {
        const fixture = await seed();
        await writeControl("open", "3");
        const session = (
          await import("@/lib/soko-bot/factory")
        ).getSokoBotRuntime();
        vi.spyOn(session, "createSession").mockResolvedValue({
          sessionId: randomUUID(),
          runtimeVersion: "test",
          acceptedAt: new Date().toISOString(),
        });
        const { turnId } = await startTurn(fixture, "preprod");
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
        await expect(startTurn(fixture, "preprod")).rejects.toMatchObject({
          status: 503,
        });
        await expect(
          prisma.sokoBotTurn.count({ where: { sokoBotId: fixture.bot.id } }),
        ).resolves.toBe(1);
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
        detached.network = "preprod";
        const delegation = await taskDelegation(fixture);
        await delegation.result;
        await expect(delegation.read()).resolves.toEqual({
          network: "preprod",
          preprodGeneration: 3,
        });
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
          await expect(schedule(fixture, "preprod")).rejects.toMatchObject({
            status: 503,
          });
          await expect(
            prisma.sokoBotSchedule.count({
              where: { sokoBotId: fixture.bot.id, systemKey: null },
            }),
          ).resolves.toBe(0);
          // A Mainnet mention in the same room is not held up.
          expect((await postMention(fixture)).status).toBe(201);
        },
      );
    });
  },
);
