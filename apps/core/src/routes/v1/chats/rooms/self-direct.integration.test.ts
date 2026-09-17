import { randomUUID } from "node:crypto";
import { makeChatRoomChannelName } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyOrganizationExitChatRevocation } from "@/helpers/chat-room-organization-exit";
import { errorHandler } from "@/helpers/error-handler";
import { prepareTasksForUserDeletion } from "@/helpers/user-deletion-tasks";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  chatRoomMessageSchema,
  chatRoomSchema,
} from "@/schemas/chat-room.schema";
import mountToken from "../../realtime/ably-token/post";
import mountDeleteRoom from "./[id]/delete";
import mountFile from "./[id]/files/post";
import mountGetRoom from "./[id]/get";
import mountInvite from "./[id]/invitations/post";
import mountLeave from "./[id]/members/me/delete";
import mountDeleteMessage from "./[id]/messages/[messageId]/delete";
import mountPatchMessage from "./[id]/messages/[messageId]/patch";
import mountSendToSelf from "./[id]/messages/[messageId]/send-to-self/post";
import mountMessages from "./[id]/messages/get";
import mountSend from "./[id]/messages/post";
import mountPatchRoom from "./[id]/patch";
import mountStar from "./[id]/star/post";
import mountList from "./get";
import mountCreate from "./post";

// Opt in with a disposable migrated Postgres, like room-unread.mute.integration.test.ts.
const databaseUrl = process.env.CHAT_SELF_INTEGRATION_DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;
vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const url = process.env.CHAT_SELF_INTEGRATION_DATABASE_URL;
  return { default: url ? createPrismaClient(url) : {} };
});
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
const { dispatch, realtime, roomsChanged, background } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  realtime: vi.fn().mockResolvedValue(undefined),
  roomsChanged: vi.fn().mockResolvedValue(undefined),
  background: [] as Promise<unknown>[],
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), BLOB_READ_WRITE_TOKEN: "test-token" }),
  };
});
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => background.push(promise),
}));
vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: dispatch,
}));
vi.mock("@/services/chat-room-message-unfurl.service", () => ({
  scheduleChatRoomMessageUnfurls: vi.fn(),
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: realtime,
}));
vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: roomsChanged,
}));
vi.mock("@/helpers/chat-message-read-budget", () => ({
  assertChatMessageReadBudget: vi.fn(),
}));
vi.mock("@/lib/ably/create-token-request", async () => {
  const { buildAblyClientCapability } = await import(
    "@/lib/ably/subscribe-capability"
  );
  return {
    createAblyClientTokenRequest: async (
      input: Parameters<typeof buildAblyClientCapability>[0],
    ) => ({
      keyName: "test.key",
      timestamp: Date.now(),
      nonce: "test",
      mac: "test",
      capability: JSON.stringify(
        buildAblyClientCapability({
          ...input,
          notificationChannelEnvironment: { network: "Preprod" },
        }),
      ),
    }),
  };
});

const ownerId = randomUUID();
const otherId = randomUUID();
const organizationIds = [randomUUID(), randomUUID()];
const workspaceIds = [randomUUID(), randomUUID()];
const vendorId = randomUUID();
const coworkerId = randomUUID();
const sokoBotId = randomUUID();
const userAuth: AuthVariables["authContext"] = {
  actor: "user",
  userId: ownerId,
  organizationId: organizationIds[0]!,
  role: "user",
};
function appFor(auth: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    c.set("requestId", "self-direct-integration");
    await next();
  });
  app.onError(errorHandler);
  for (const mount of [
    mountList,
    mountCreate,
    mountGetRoom,
    mountMessages,
    mountSend,
    mountPatchMessage,
    mountDeleteMessage,
    mountFile,
    mountToken,
    mountPatchRoom,
    mountInvite,
    mountLeave,
    mountDeleteRoom,
    mountStar,
    mountSendToSelf,
  ]) {
    mount(app);
  }
  return app;
}
function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
async function openSelf(auth = userAuth) {
  const response = await appFor(auth).request(
    "/",
    jsonRequest("POST", { kind: "direct", memberUserIds: [ownerId] }),
  );
  expect([200, 201]).toContain(response.status);
  return {
    status: response.status,
    room: chatRoomSchema.parse((await response.json()).data),
  };
}
async function createSourceDirect(userIds = [ownerId, otherId]) {
  const room = await prisma.chatRoom.create({
    data: {
      kind: "direct",
      organizationId: organizationIds[1]!,
      name: "Source direct",
      directKey: `direct:v2:${randomUUID()}`,
      createdByUserId: ownerId,
      userMembers: { create: userIds.map((userId) => ({ userId })) },
    },
  });
  const message = await prisma.chatRoomMessage.create({
    data: {
      roomId: room.id,
      senderUserId: ownerId,
      content: "Ship the launch notes",
    },
  });
  return { room, message };
}
async function sendToSelf(
  roomId: string,
  messageId: string,
  auth = userAuth,
): Promise<Response> {
  return appFor(auth).request(`/${roomId}/messages/${messageId}/send-to-self`, {
    method: "POST",
  });
}
async function drainBackground() {
  await Promise.all(background.splice(0));
}

describeWithDb("Self Direct through chat HTTP handlers with Postgres", () => {
  beforeAll(async () => {
    for (const id of [ownerId, otherId]) {
      await prisma.user.create({
        data: {
          id,
          name: id === ownerId ? "Note owner" : "Organization admin",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    for (const [index, id] of organizationIds.entries()) {
      await prisma.organization.create({
        data: {
          id,
          slug: `self-direct-${id}`,
          name: "Self Direct test",
          workspace: { create: { id: workspaceIds[index] } },
          members: {
            create: [
              { userId: ownerId, role: "member", seatAssignedAt: null },
              { userId: otherId, role: "admin", seatAssignedAt: null },
            ],
          },
        },
      });
    }
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        name: "Self Direct test coworker",
        slug: `self-direct-${coworkerId}`,
        isWhitelisted: true,
        capabilities: ["chat"],
        baseURL: "https://coworker.example.test",
        vendor: {
          create: {
            id: vendorId,
            name: "Self Direct test vendor",
            slug: `self-direct-${vendorId}`,
          },
        },
      },
    });
    await prisma.sokoBot.create({
      data: {
        id: sokoBotId,
        userId: ownerId,
        workspaceId: workspaceIds[0]!,
      },
    });
  });
  afterAll(async () => {
    await drainBackground();
    await prisma.chatRoom.deleteMany({
      where: { createdByUserId: { in: [ownerId, otherId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.coworker.deleteMany({ where: { id: coworkerId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  it("converges parallel opens on one private room for an unseated organization-only user", async () => {
    const opens = await Promise.all(
      Array.from({ length: 4 }, () => openSelf()),
    );
    expect(opens.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(new Set(opens.map(({ room }) => room.id)).size).toBe(1);
    expect(opens[0]!.room).toMatchObject({
      organizationId: null,
      isSelfDirect: true,
      userMembers: [{ id: ownerId }],
      coworkerMembers: [],
      sokoBotMembers: [],
    });
  });

  it("persists notes across workspace changes and retries without self-attention or AI work", async () => {
    const { room } = await openSelf();
    const content = `Remember **the draft** @${ownerId} @all @${coworkerId} @${sokoBotId}`;
    const body = {
      content,
      clientMessageId: randomUUID(),
      mentionedUserIds: [ownerId],
      mentionedCoworkerIds: [coworkerId],
      mentionedSokoBotIds: [sokoBotId],
    };
    const app = appFor(userAuth);
    const first = await app.request(
      `/${room.id}/messages`,
      jsonRequest("POST", body),
    );
    expect(first.status).toBe(201);
    const message = chatRoomMessageSchema.parse((await first.json()).data);
    const retry = await app.request(
      `/${room.id}/messages`,
      jsonRequest("POST", body),
    );
    expect(retry.status).toBe(201);
    expect((await retry.json()).data.id).toBe(message.id);
    await drainBackground();
    expect(dispatch).not.toHaveBeenCalled();
    expect(realtime).toHaveBeenCalled();
    expect(
      await prisma.notification.count({ where: { userId: ownerId } }),
    ).toBe(0);
    expect(
      await prisma.chatRoomReadState.count({
        where: { roomId: room.id, userId: ownerId },
      }),
    ).toBe(1);

    // The personal context becomes valid only once a personal workspace exists.
    await prisma.workspace.create({ data: { userId: ownerId } });
    for (const organizationId of [organizationIds[1]!, null]) {
      const auth = { ...userAuth, organizationId };
      expect((await openSelf(auth)).room.id).toBe(room.id);
      const nextApp = appFor(auth);
      const list = await nextApp.request("/");
      expect(list.status).toBe(200);
      expect((await list.json()).data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: room.id,
            isSelfDirect: true,
            unreadCount: 0,
            unreadMentionCount: 0,
          }),
        ]),
      );
      const read = await nextApp.request(`/${room.id}`);
      expect(read.status).toBe(200);
      expect((await read.json()).data.isSelfDirect).toBe(true);
      const history = await nextApp.request(`/${room.id}/messages?q=Remember`);
      expect(history.status).toBe(200);
      expect((await history.json()).data).toMatchObject([
        { id: message.id, content },
      ]);
    }
    const edit = await app.request(
      `/${room.id}/messages/${message.id}`,
      jsonRequest("PATCH", { content: "Revised note" }),
    );
    expect(edit.status).toBe(200);
    const remove = await app.request(`/${room.id}/messages/${message.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);
    const search = await app.request(`/${room.id}/messages?q=Revised`);
    expect((await search.json()).data).toEqual([]);
    await drainBackground();
  });

  it.each([
    [
      "another user",
      { actor: "user", userId: otherId, organizationId: null, role: "user" },
    ],
    [
      "organization admin",
      {
        actor: "user",
        userId: otherId,
        organizationId: organizationIds[0],
        role: "admin",
      },
    ],
    [
      "coworker",
      {
        actor: "coworker",
        coworkerId,
        vendorId,
        context: { userId: ownerId, organizationId: organizationIds[0] },
      },
    ],
    [
      "Soko Bot",
      {
        actor: "sokoBot",
        sokoBotId,
        workspaceId: workspaceIds[0]!,
        userId: ownerId,
        organizationId: organizationIds[0],
      },
    ],
  ] satisfies Array<[string, AuthVariables["authContext"]]>)(
    "denies room, history, writes, files and subscriptions to %s",
    async (_name, auth) => {
      const { room } = await openSelf();
      const app = appFor(auth);
      for (const [path, request] of [
        [`/${room.id}`, {}],
        [`/${room.id}/messages`, {}],
        [`/${room.id}/messages`, jsonRequest("POST", { content: "Intrusion" })],
        [
          `/${room.id}/files`,
          jsonRequest("POST", {
            filename: "note.txt",
            contentType: "text/plain",
            size: 5,
          }),
        ],
      ] satisfies Array<[string, RequestInit]>) {
        const response = await app.request(path, request);
        expect([403, 404], `${auth.actor} ${path}`).toContain(response.status);
      }
      const list = await app.request("/");
      if (auth.actor === "user") {
        expect(list.status).toBe(200);
        expect((await list.json()).data).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: room.id })]),
        );
        const token = await app.request("/ably-token", { method: "POST" });
        expect(token.status).toBe(200);
        expect(
          JSON.parse((await token.json()).data.capability),
        ).not.toHaveProperty(makeChatRoomChannelName(room.id));
      } else {
        expect(list.status).toBe(403);
        expect(
          (await app.request("/ably-token", { method: "POST" })).status,
        ).toBe(403);
        // AI actors still resolve their own AI Direct shape, never the owner's self key.
        const create = await app.request(
          "/",
          jsonRequest("POST", { kind: "direct", memberUserIds: [ownerId] }),
        );
        expect(create.status).toBe(201);
        const aiDirect = chatRoomSchema.parse((await create.json()).data);
        expect(aiDirect.id).not.toBe(room.id);
        expect(aiDirect).toMatchObject({
          kind: "direct",
          organizationId: organizationIds[0],
          isSelfDirect: false,
          userMembers: [{ id: ownerId }],
          coworkerMembers:
            auth.actor === "coworker" ? [{ id: coworkerId }] : [],
          sokoBotMembers: auth.actor === "sokoBot" ? [{ id: sokoBotId }] : [],
        });
      }
    },
  );

  it("keeps membership immutable, allows pinning, and restores the same archived self identity", async () => {
    const { room } = await openSelf();
    const app = appFor(userAuth);
    for (const [path, request] of [
      [
        `/${room.id}`,
        jsonRequest("PATCH", { memberUserIds: [ownerId, otherId] }),
      ],
      [
        `/${room.id}/invitations`,
        jsonRequest("POST", { email: `${otherId}@example.test` }),
      ],
      [`/${room.id}/members/me`, { method: "DELETE" }],
      [`/${room.id}`, { method: "DELETE" }],
    ] satisfies Array<[string, RequestInit]>) {
      expect([400, 403, 404], path).toContain(
        (await app.request(path, request)).status,
      );
    }
    expect(
      (await app.request(`/${room.id}/star`, { method: "POST" })).status,
    ).toBe(200);
    const token = await app.request("/ably-token", { method: "POST" });
    expect(JSON.parse((await token.json()).data.capability)).toHaveProperty(
      makeChatRoomChannelName(room.id),
    );
    await prisma.chatRoom.update({
      where: { id: room.id },
      data: { archivedAt: new Date() },
    });
    const restored = await openSelf();
    expect(restored.status).toBe(200);
    expect(restored.room.id).toBe(room.id);
    expect(restored.room.isSelfDirect).toBe(true);
  });

  it("sends a quote of a room message into a Self Direct created on demand", async () => {
    const source = await createSourceDirect();
    const otherAuth: AuthVariables["authContext"] = {
      ...userAuth,
      userId: otherId,
    };
    roomsChanged.mockClear();
    realtime.mockClear();

    const response = await sendToSelf(
      source.room.id,
      source.message.id,
      otherAuth,
    );
    expect(response.status).toBe(201);
    const saved = chatRoomMessageSchema.parse((await response.json()).data);
    expect(saved.roomId).not.toBe(source.room.id);
    expect(saved).toMatchObject({
      content: "",
      quote: {
        messageId: source.message.id,
        roomId: source.room.id,
        authorName: "Note owner",
        snippet: "Ship the launch notes",
      },
    });
    const selfRoom = await appFor(otherAuth).request(`/${saved.roomId}`);
    expect((await selfRoom.json()).data).toMatchObject({
      isSelfDirect: true,
      userMembers: [{ id: otherId }],
    });
    expect(realtime).toHaveBeenCalledWith(
      expect.objectContaining({ id: saved.id }),
      "create",
    );
    expect(roomsChanged).toHaveBeenCalledTimes(1);
    expect(roomsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [otherId], roomId: saved.roomId }),
    );
    expect(
      await prisma.chatRoomReadState.count({
        where: { roomId: saved.roomId, userId: otherId },
      }),
    ).toBe(1);

    const again = await sendToSelf(
      source.room.id,
      source.message.id,
      otherAuth,
    );
    expect(again.status).toBe(201);
    expect((await again.json()).data.roomId).toBe(saved.roomId);
    expect(roomsChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved quote readable after its source room is left", async () => {
    const { room: selfRoom } = await openSelf();
    const source = await createSourceDirect();
    const response = await sendToSelf(source.room.id, source.message.id);
    expect(response.status).toBe(201);
    const saved = chatRoomMessageSchema.parse((await response.json()).data);
    expect(saved.roomId).toBe(selfRoom.id);

    await prisma.chatRoomUserMember.deleteMany({
      where: { roomId: source.room.id, userId: ownerId },
    });

    const history = await appFor(userAuth).request(`/${selfRoom.id}/messages`);
    expect((await history.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: saved.id,
          quote: expect.objectContaining({
            roomId: source.room.id,
            snippet: "Ship the launch notes",
          }),
        }),
      ]),
    );
    expect((await sendToSelf(source.room.id, source.message.id)).status).toBe(
      404,
    );
  });

  it("rejects sending a message from the Self Direct itself", async () => {
    const { room } = await openSelf();
    const note = await appFor(userAuth).request(
      `/${room.id}/messages`,
      jsonRequest("POST", { content: "Already here" }),
    );
    const message = chatRoomMessageSchema.parse((await note.json()).data);
    expect((await sendToSelf(room.id, message.id)).status).toBe(400);
    await drainBackground();
  });

  it("rejects a membership status message", async () => {
    const { room } = await createSourceDirect();
    const membership = await prisma.chatRoomMessage.create({
      data: {
        roomId: room.id,
        senderUserId: ownerId,
        content: "",
        metadata: {
          membership: {
            action: "joined",
            subject: { type: "user", id: otherId, name: "Organization admin" },
          },
        },
      },
    });
    expect((await sendToSelf(room.id, membership.id)).status).toBe(400);
  });

  it("hides unreadable, deleted and missing messages", async () => {
    const foreign = await createSourceDirect([otherId]);
    expect((await sendToSelf(foreign.room.id, foreign.message.id)).status).toBe(
      404,
    );

    const source = await createSourceDirect();
    expect((await sendToSelf(source.room.id, randomUUID())).status).toBe(404);
    await prisma.chatRoomMessage.update({
      where: { id: source.message.id },
      data: { deletedAt: new Date() },
    });
    expect((await sendToSelf(source.room.id, source.message.id)).status).toBe(
      404,
    );
  });

  it("does not label a former group with one remaining member as Self Direct", async () => {
    const former = await prisma.chatRoom.create({
      data: {
        kind: "direct",
        name: "Former group",
        directKey: `direct:v2:${randomUUID()}`,
        createdByUserId: ownerId,
        userMembers: { create: { userId: ownerId } },
      },
    });
    const response = await appFor(userAuth).request(`/${former.id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.isSelfDirect).toBe(false);
  });

  it("survives organization exit and is deleted with its owner's account", async () => {
    const { room } = await openSelf();
    await prisma.$transaction(async (tx) => {
      await applyOrganizationExitChatRevocation(
        tx,
        ownerId,
        organizationIds[0]!,
      );
      await tx.member.deleteMany({
        where: { userId: ownerId, organizationId: organizationIds[0] },
      });
    });
    const nextApp = appFor({
      ...userAuth,
      organizationId: organizationIds[1]!,
    });
    expect((await nextApp.request(`/${room.id}`)).status).toBe(200);
    await prepareTasksForUserDeletion(ownerId, prisma);
    expect((await nextApp.request(`/${room.id}`)).status).toBe(404);
    expect(
      await prisma.chatRoom.findUnique({ where: { id: room.id } }),
    ).toBeNull();
  });
});
