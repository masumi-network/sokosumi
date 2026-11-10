import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetRecentSokoBotChats from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1000;
const reader = randomUUID();
const teammate = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const ids = {
  chat: randomUUID(),
  thread: randomUUID(),
  otherOrg: randomUUID(),
  people: randomUUID(),
  stale: randomUUID(),
  deleted: randomUUID(),
  busy: Array.from({ length: 9 }, () => randomUUID()),
};
const parentId = randomUUID();
const replyId = randomUUID();
const chatMessageId = randomUUID();
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

// Real Prisma and SQL against the migrated schema: the grouping, the
// relation filters and the cap are the database's, so a mocked client would
// prove nothing about which rooms make the cut.
describe.skipIf(!enabled)("GET /chats/recent against PostgreSQL", () => {
  let botId = "";

  async function room(
    id: string,
    options: { org?: string | null; withBot?: boolean } = {},
  ) {
    await prisma.chatRoom.create({
      data: {
        id,
        organizationId: options.org ?? null,
        name: "Fixture chat",
        kind: "direct",
        createdByUserId: reader,
        userMembers: { create: [{ userId: reader }, { userId: teammate }] },
        ...(options.withBot === false
          ? {}
          : { sokoBotMembers: { create: [{ sokoBotId: botId }] } }),
      },
    });
  }

  function said(
    roomId: string,
    hoursAgo: number,
    by: "reader" | "teammate" | "bot",
    extra: { id?: string; parentMessageId?: string; deletedAt?: Date } = {},
  ) {
    return prisma.chatRoomMessage.create({
      data: {
        roomId,
        content: `${by} at -${hoursAgo}h`,
        createdAt: ago(hoursAgo),
        ...(by === "bot"
          ? { senderSokoBotId: botId }
          : { senderUserId: by === "reader" ? reader : teammate }),
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    for (const id of [reader, teammate]) {
      await prisma.user.create({
        data: {
          id,
          name: "Recent chats fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(id === reader
            ? { workspace: { create: { id: workspaceId } } }
            : {}),
        },
      });
    }
    await prisma.organization.create({
      data: { id: organizationId, name: "Other org", slug: organizationId },
    });
    botId = (
      await prisma.sokoBot.create({ data: { userId: reader, workspaceId } })
    ).id;

    // The reader asked here 3 hours ago; 25 newer bot and teammate messages
    // follow, more than any recent-messages window.
    await room(ids.chat);
    await said(ids.chat, 3, "reader", { id: chatMessageId });
    for (let i = 0; i < 25; i += 1) {
      await said(ids.chat, 2 - i / 20, i % 2 ? "bot" : "teammate");
    }

    // Old top-level ask, today's answer from the reader inside its Thread.
    await room(ids.thread);
    await said(ids.thread, 30, "reader", { id: parentId });
    await said(ids.thread, 1, "reader", {
      id: replyId,
      parentMessageId: parentId,
    });

    // Nine newer rooms where only the bot and a teammate spoke: they must
    // not crowd the reader's rooms out of the cap.
    for (const id of ids.busy) {
      await room(id);
      await said(id, 0.5, "bot");
      await said(id, 0.4, "teammate");
    }

    // Left out: another workspace, no Soko Bot, over a day old, deleted.
    await room(ids.otherOrg, { org: organizationId });
    await said(ids.otherOrg, 0.2, "reader");
    await room(ids.people, { withBot: false });
    await said(ids.people, 0.2, "reader");
    await room(ids.stale);
    await said(ids.stale, 25, "reader");
    await room(ids.deleted);
    await said(ids.deleted, 0.2, "reader", { deletedAt: new Date() });
  });

  afterAll(async () => {
    await prisma.chatRoom.deleteMany({
      where: { id: { in: [...Object.values(ids).flat()] } },
    });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [reader, teammate] } } });
    await prisma.$disconnect();
  });

  it("returns the reader's newest own message per Soko Bot room of this workspace, replies included", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("requestId", "recent-soko-bot-chats");
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: reader,
        organizationId: null,
        role: "user",
      });
      await next();
    });
    app.onError((error, c) => c.json({ error: error.message }, 500));
    mountGetRecentSokoBotChats(app);

    const response = await app.request("http://localhost/");
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(
      body.data.map(
        (row: {
          roomId: string;
          messageId: string;
          parentMessageId: string | null;
        }) => [row.roomId, row.messageId, row.parentMessageId],
      ),
    ).toEqual([
      [ids.thread, replyId, parentId],
      [ids.chat, chatMessageId, null],
    ]);
  });
});
