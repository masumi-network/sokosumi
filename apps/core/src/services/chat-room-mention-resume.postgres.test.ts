import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { StartSokoBotTurnInput } from "@/lib/soko-bot/turn-start";
import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const harness = vi.hoisted(() => ({
  background: [] as Promise<unknown>[],
  preprod: false,
  startTurn: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock("@/lib/network", async (original) => ({
  ...(await original<typeof import("@/lib/network")>()),
  isPreprodOn: () => harness.preprod,
}));
vi.mock("@/middleware/auth", async (original) => ({
  ...(await original<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@vercel/functions", async (original) => ({
  ...(await original<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => harness.background.push(work),
}));
vi.mock("@/services/soko-bot-control-plane.service", async (original) => ({
  ...(await original<
    typeof import("@/services/soko-bot-control-plane.service")
  >()),
  sokoBotControlPlane: { startTurn: harness.startTurn },
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
  publishChatRoomMessageRealtimeById: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/chat-room-message-created-effects", () => ({
  invalidateChatRoomMessageReaders: vi.fn().mockResolvedValue(undefined),
}));
// The separate publisher can run before or after collection. Keep the
// durable notification write real and capture statements up to that handoff.
vi.mock("@/helpers/notification-publish", async (original) => ({
  ...(await original<typeof import("@/helpers/notification-publish")>()),
  dispatchNotificationPublish: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
vi.mock("@/routes/v1/chats/stream/coworker-conversation", async (original) => ({
  ...(await original<
    typeof import("@/routes/v1/chats/stream/coworker-conversation")
  >()),
  createCoworkerConversation: harness.conversation,
}));
vi.mock("@/lib/sokosumi-ai-provider", async (original) => ({
  ...(await original<typeof import("@/lib/sokosumi-ai-provider")>()),
  getSokosumiProvider: () => () => ({}),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  streamText: () => ({ text: Promise.resolve("The Coworker answered.") }),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const targets = ["Soko Bot", "Coworker"] as const;
const paths = ["dispatch", "reclaim", "retry"] as const;
type Target = (typeof targets)[number];
type Path = (typeof paths)[number];

describe.skipIf(!enabled)("detached chat mentions on PostgreSQL", () => {
  let db: typeof import("@/lib/db/prisma").default;
  let dispatch: typeof import("./chat-room-coworker-dispatch.service").dispatchChatRoomMention;
  let scan: typeof import("./chat-room-mention-state").listStaleSentChatRoomMentionIds;
  let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
  let createNetworkScope: typeof import("@/lib/db/network-scope").createNetworkScope;
  let mountRetry: typeof import("@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post").default;
  let App: typeof import("@/lib/hono").OpenAPIHonoWithAuth;
  let errorHandler: typeof import("@/helpers/error-handler").errorHandler;
  let staleMs: number;
  let pauseKey: string;
  let generationKey: string;

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", String(onSplitLayout));
    ({ default: db } = await import("@/lib/db/prisma"));
    ({ dispatchChatRoomMention: dispatch } = await import(
      "./chat-room-coworker-dispatch.service"
    ));
    ({ listStaleSentChatRoomMentionIds: scan, ROOM_SENT_STALE_MS: staleMs } =
      await import("./chat-room-mention-state"));
    ({ createPersonalWorkspace } = await import(
      "@/helpers/personal-workspace"
    ));
    ({ createNetworkScope } = await import("@/lib/db/network-scope"));
    ({ default: mountRetry } = await import(
      "@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
    ));
    ({ OpenAPIHonoWithAuth: App } = await import("@/lib/hono"));
    ({ errorHandler } = await import("@/helpers/error-handler"));
    ({ PREPROD_PAUSE_KEY: pauseKey, PREPROD_GENERATION_KEY: generationKey } =
      await import("@/helpers/preprod-control"));
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  beforeEach(() => {
    harness.preprod = onSplitLayout;
    harness.conversation
      .mockReset()
      .mockResolvedValue({ id: "coworker-conversation" });
    harness.startTurn
      .mockReset()
      .mockImplementation(async (input: StartSokoBotTurnInput) => {
        if (!input.sokoBotId || !input.chat?.mentionId)
          throw new Error("Missing mention handoff");
        const turn = await db.sokoBotTurn.create({
          data: {
            sokoBotId: input.sokoBotId,
            workspaceId: input.workspaceId,
            requestedByUserId: input.userId,
            network: input.network,
            preprodGeneration: input.expectedPreprodGeneration ?? null,
            source: "CHAT",
            status: "RUNNING",
            clientTurnId: input.clientTurnId,
            userMessage: input.message,
            chatMentionId: input.chat.mentionId,
            chatResponseMessageId: input.chat.responseMessageId,
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 60_000),
          },
          select: { id: true },
        });
        return { turnId: turn.id, status: "RUNNING" };
      });
  });

  async function control(pause: string, generation: string) {
    const keys = [pauseKey, generationKey];
    const before = await db.syncMetadata.findMany({
      where: { key: { in: keys } },
    });
    onTestFinished(async () => {
      await db.syncMetadata.deleteMany({ where: { key: { in: keys } } });
      await db.syncMetadata.createMany({ data: before });
    });
    for (const [key, cursorId] of [
      [pauseKey, pause],
      [generationKey, generation],
    ]) {
      await db.syncMetadata.upsert({
        where: { key },
        create: { key, cursorId, lastSyncedAt: new Date() },
        update: { cursorId },
      });
    }
  }

  async function seed(
    target: Target,
    path: Path,
    network: "mainnet" | "preprod" | null,
  ) {
    const userId = randomUUID();
    await db.user.create({
      data: {
        id: userId,
        name: "Mention resume owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    onTestFinished(async () => {
      await db.user.delete({ where: { id: userId } });
    });
    const { id: workspaceId } = await createPersonalWorkspace(userId);
    const bot =
      target === "Soko Bot"
        ? await db.sokoBot.create({
            data: { userId, workspaceId },
          })
        : null;
    let coworkerId: string | null = null;
    if (!bot) {
      const vendor = await db.vendor.create({
        data: { name: "Mention resume provider", slug: userId },
      });
      onTestFinished(async () => {
        await db.vendor.delete({ where: { id: vendor.id } });
      });
      const coworker = await db.coworker.create({
        data: {
          name: "Mention resume Coworker",
          slug: userId,
          vendorId: vendor.id,
          isWhitelisted: true,
          capabilities: ["chat"],
          baseURL: "https://example.test",
        },
      });
      coworkerId = coworker.id;
      onTestFinished(async () => {
        await db.coworker.delete({ where: { id: coworker.id } });
      });
    }
    const room = await db.chatRoom.create({
      data: {
        name: "Mention resume room",
        kind: "direct",
        directKey: `mention-resume:${userId}`,
        createdByUserId: userId,
        userMembers: { create: { userId } },
        ...(bot && { sokoBotMembers: { create: { sokoBotId: bot.id } } }),
        ...(coworkerId && { coworkerMembers: { create: { coworkerId } } }),
      },
    });
    onTestFinished(async () => {
      await db.chatRoom.delete({ where: { id: room.id } });
    });
    const source = await db.chatRoomMessage.create({
      data: { roomId: room.id, senderUserId: userId, content: "Please answer" },
    });
    const mention = await db.chatRoomMention.create({
      data: {
        messageId: source.id,
        sokoBotId: bot?.id ?? null,
        coworkerId,
        network,
        preprodGeneration: network === "preprod" ? 7 : null,
        status:
          path === "retry" ? "failed" : path === "reclaim" ? "sent" : "pending",
        error: path === "retry" ? "First attempt failed" : null,
        ...(path === "reclaim" && {
          updatedAt: new Date(Date.now() - staleMs - 1_000),
        }),
      },
    });
    const previous =
      path === "retry" && bot
        ? await db.sokoBotTurn.create({
            data: {
              sokoBotId: bot.id,
              workspaceId,
              requestedByUserId: userId,
              source: "CHAT",
              status: "FAILED",
              clientTurnId: `chat:${mention.id}`,
              userMessage: source.content,
              chatMentionId: mention.id,
              capabilityNames: [],
              deadlineAt: new Date(),
              network: network ?? "mainnet",
              preprodGeneration: mention.preprodGeneration,
            },
          })
        : null;
    return { room, source, mention, previous, userId };
  }

  type Fixture = Awaited<ReturnType<typeof seed>>;

  async function drainBackground() {
    while (harness.background.length)
      await Promise.all(harness.background.splice(0));
  }

  async function act(
    fixture: Fixture,
    path: Path,
  ): Promise<Response | undefined> {
    const { room, source, mention, userId } = fixture;
    if (path === "dispatch") {
      await dispatch(mention.id);
      await drainBackground();
      return;
    }
    if (path === "reclaim") {
      expect(await scan(room.id)).toEqual([mention.id]);
      await dispatch(mention.id);
      await drainBackground();
      return;
    }
    const app = new App();
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId,
        organizationId: null,
        role: "user",
      });
      await next();
    });
    app.onError(errorHandler);
    mountRetry(app);
    const response = await app.request(
      `/${room.id}/messages/${source.id}/mentions/${mention.id}/retry`,
      { method: "POST" },
    );
    await drainBackground();
    return response;
  }

  function stored(fixture: Fixture) {
    return db.chatRoomMention.findUniqueOrThrow({
      where: { id: fixture.mention.id },
    });
  }

  async function assertAnswered(
    fixture: Fixture,
    target: Target,
    network: "mainnet" | "preprod",
  ) {
    const current = await stored(fixture);
    const messages = await db.chatRoomMessage.findMany({
      where: { roomId: fixture.room.id, id: { not: fixture.source.id } },
    });
    expect(messages).toHaveLength(1);
    expect(current.responseMessageId).toBe(messages[0]?.id);
    expect(current.network).toBe(fixture.mention.network);
    if (target === "Coworker") {
      expect(harness.conversation).toHaveBeenCalledTimes(1);
      expect(harness.startTurn).not.toHaveBeenCalled();
      expect(current).toMatchObject({
        status: "responded",
        providerConversationId: "coworker-conversation",
      });
      expect(messages[0]?.content).toBe("The Coworker answered.");
      expect(
        await db.notification.count({
          where: {
            userId: fixture.userId,
            eventId: messages[0]?.id,
            kind: "CHAT",
          },
        }),
      ).toBe(1);
    } else {
      expect(harness.conversation).not.toHaveBeenCalled();
      expect(harness.startTurn).toHaveBeenCalledTimes(1);
      expect(current.status, current.error ?? undefined).toBe("sent");
      expect(messages[0]?.metadata).toMatchObject({ streaming: true });
      expect(
        await db.sokoBotTurn.findUnique({
          where: { chatMentionId: current.id },
        }),
      ).toMatchObject({
        network,
        preprodGeneration: network === "preprod" ? 7 : null,
        status: "RUNNING",
        chatResponseMessageId: messages[0]?.id,
      });
      if (fixture.previous)
        expect(
          await db.sokoBotTurn.findUnique({
            where: { id: fixture.previous.id },
          }),
        ).toMatchObject({
          status: "FAILED",
          chatMentionId: null,
        });
    }
    await assertNoDebit(fixture);
  }

  async function assertNoDebit(fixture: Fixture) {
    const networks = onSplitLayout
      ? (["mainnet", "preprod"] as const)
      : (["mainnet"] as const);
    for (const network of networks) {
      const side = createNetworkScope(network).networkDb;
      expect(
        await side.transaction.count({
          where: { userId: fixture.userId, amount: { lt: 0 } },
        }),
      ).toBe(0);
      expect(
        await side.sokoBotUsage.count({ where: { userId: fixture.userId } }),
      ).toBe(0);
    }
  }

  const deliveries = targets.flatMap((target) =>
    paths.map((path) => ({ target, path })),
  );
  const mainnetStatements = {
    "Soko Bot": { dispatch: 28, reclaim: 30, retry: 61 },
    Coworker: { dispatch: 47, reclaim: 49, retry: 78 },
  };
  it.each(
    deliveries.flatMap((scenario) =>
      (["mainnet", null] as const).map((network) => ({ ...scenario, network })),
    ),
  )(
    "keeps Mainnet $target $path with tag $network",
    async ({ target, path, network }) => {
      await control("paused", "8");
      const fixture = await seed(target, path, network);
      await drainBackground();
      const recorder = recordStatements();
      let response: Response | undefined;
      try {
        response = await act(fixture, path);
      } finally {
        recorder.restore();
      }
      if (response) expect(response.status, await response.text()).toBe(200);
      expect(recorder.statements.flat()).not.toContain(pauseKey);
      expect(recorder.statements.flat()).not.toContain(generationKey);
      expect(recorder.statements).toHaveLength(mainnetStatements[target][path]);
      await assertAnswered(fixture, target, "mainnet");
    },
  );

  it.skipIf(!onSplitLayout).each(deliveries)(
    "resumes a current Preprod $target via $path",
    async ({ target, path }) => {
      await control("open", "7");
      const fixture = await seed(target, path, "preprod");
      const response = await act(fixture, path);
      if (response) expect(response.status, await response.text()).toBe(200);
      await assertAnswered(fixture, target, "preprod");
    },
  );

  it.skipIf(!onSplitLayout).each(["paused", "stale"] as const)(
    "handles a %s refusal at the Soko Bot turn writer",
    async (state) => {
      await control("open", "7");
      const fixture = await seed("Soko Bot", "dispatch", "preprod");
      const { DetachedNetworkRefusal } = await import(
        "@/lib/soko-bot/detached-network"
      );
      harness.startTurn.mockRejectedValueOnce(
        state === "paused"
          ? new HTTPException(503)
          : new DetachedNetworkRefusal("soko_bot_network_stale"),
      );

      await act(fixture, "dispatch");

      expect(harness.startTurn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          network: "preprod",
          expectedPreprodGeneration: 7,
        }),
      );
      const mention = await stored(fixture);
      expect(mention.status).toBe(state === "paused" ? "sent" : "failed");
      expect(
        await db.chatRoomMessage.findFirst({
          where: { id: mention.responseMessageId ?? "" },
        }),
      ).toMatchObject({
        content: "",
        metadata:
          state === "paused" ? { streaming: true } : { mention_failed: true },
      });
      expect(
        await db.sokoBotTurn.count({ where: { chatMentionId: mention.id } }),
      ).toBe(0);
      await assertNoDebit(fixture);
    },
  );

  it.skipIf(!onSplitLayout)(
    "does not release a failed turn from another Network on Retry",
    async () => {
      await control("open", "7");
      const fixture = await seed("Soko Bot", "retry", "preprod");
      if (!fixture.previous) throw new Error("Missing linked turn");
      const linked = await db.sokoBotTurn.update({
        where: { id: fixture.previous.id },
        data: { network: "mainnet", preprodGeneration: null },
      });

      const response = await act(fixture, "retry");

      expect(response?.status).toBe(409);
      expect(await response?.json()).toMatchObject({
        kind: "soko_bot_network_stale",
      });
      expect(await stored(fixture)).toEqual(fixture.mention);
      expect(
        await db.sokoBotTurn.findUnique({ where: { id: linked.id } }),
      ).toEqual(linked);
      expect(harness.startTurn).not.toHaveBeenCalled();
    },
  );

  it.skipIf(!onSplitLayout).each(
    targets.flatMap((target) => [
      {
        target,
        pause: "open",
        generation: "7",
        status: 403,
        kind: "preprod_off",
      },
      {
        target,
        pause: "paused",
        generation: "7",
        status: 503,
        kind: "preprod_paused",
      },
      {
        target,
        pause: "open",
        generation: "broken",
        status: 503,
        kind: "preprod_control_unavailable",
      },
      {
        target,
        pause: "paused",
        generation: "8",
        status: 409,
        kind: "soko_bot_network_stale",
      },
    ]),
  )("refuses $target dispatch, reclaim and retry with $kind", async (state) => {
    await control(state.pause, state.generation);
    harness.preprod = state.status !== 403;
    if (state.kind === "preprod_control_unavailable") {
      expectCoreLog(
        "error",
        "Could not read the Preprod pause and generation",
        3,
      );
    }
    for (const path of paths) {
      const fixture = await seed(state.target, path, "preprod");
      const response = await act(fixture, path);
      if (path === "retry") {
        expect(response?.status).toBe(state.status);
        expect(await response?.json()).toMatchObject({ kind: state.kind });
        expect(await stored(fixture)).toEqual(fixture.mention);
        if (fixture.previous)
          expect(
            await db.sokoBotTurn.findUnique({
              where: { id: fixture.previous.id },
            }),
          ).toEqual(fixture.previous);
      } else if (state.status === 409) {
        expect(await stored(fixture)).toMatchObject({
          status: "failed",
          error: state.kind,
          responseMessageId: null,
        });
      } else {
        expect(await stored(fixture)).toEqual(fixture.mention);
      }
      await assertNoDebit(fixture);
    }
    expect(harness.conversation).not.toHaveBeenCalled();
    expect(harness.startTurn).not.toHaveBeenCalled();
  });

  it
    .skipIf(!onSplitLayout)
    .each(
      targets.flatMap((target) =>
        (["pause", "raise"] as const).flatMap((action) =>
          ["operator", "reader"].map((first) => ({ target, action, first })),
        ),
      ),
    )(
    "observes $action at $target dispatch when the $first wins",
    async ({ target, action, first }) => {
      await control("open", "7");
      const fixture = await seed(target, "dispatch", "preprod");
      const operator = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await operator.connect();
      onTestFinished(() => operator.end());
      const schema = testSchemaNames().DATABASE_SCHEMA_SHARED;
      await operator.query("BEGIN");
      await operator.query(
        `UPDATE "${schema}".sync_metadata SET "cursorId" = $1 WHERE "key" = $2`,
        action === "pause" ? ["paused", pauseKey] : ["8", generationKey],
      );

      const read = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const find = db.chatRoomMention.findUnique.bind(db.chatRoomMention);
      const spy = vi
        .spyOn(db.chatRoomMention, "findUnique")
        .mockImplementationOnce((args) => {
          const pending = (async () => {
            const result = await find(args);
            read.resolve();
            await resume.promise;
            return result;
          })();
          return pending as ReturnType<typeof find>;
        });
      onTestFinished(() => spy.mockRestore());
      const work = act(fixture, "dispatch");
      try {
        await read.promise;
        if (first === "operator") await operator.query("COMMIT");
        resume.resolve();
        await work;
        if (first === "reader") {
          await operator.query("COMMIT");
          await assertAnswered(fixture, target, "preprod");
        } else {
          expect(harness.startTurn).not.toHaveBeenCalled();
          expect(harness.conversation).not.toHaveBeenCalled();
          if (action === "pause")
            expect(await stored(fixture)).toEqual(fixture.mention);
          else
            expect(await stored(fixture)).toMatchObject({
              status: "failed",
              error: "soko_bot_network_stale",
            });
          await assertNoDebit(fixture);
        }
      } finally {
        resume.resolve();
        if (operator.getTransactionStatus() !== "I")
          await operator.query("ROLLBACK");
      }
    },
  );
});
