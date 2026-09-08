import { createPrismaClient } from "@sokosumi/database/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { captureException, databaseUrlFor } = vi.hoisted(() => ({
  captureException: vi.fn(),
  databaseUrlFor(application: string) {
    const configured = process.env.PREVIEW_INTEGRATION_DATABASE_URL;
    if (!configured) return undefined;
    const url = new URL(configured);
    if (
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/notification_preview_test"
    ) {
      throw new Error(
        "Preview integration tests require a dedicated local notification_preview_test database",
      );
    }
    url.searchParams.set("application_name", application);
    return url.toString();
  },
}));
vi.mock("@sentry/node", () => ({ captureException }));
vi.mock("@/helpers/notifications", () => ({}));
vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const url = databaseUrlFor("preview-rewrite");
  return { default: url ? createPrismaClient(url) : {} };
});

import prisma from "@/lib/db/prisma";
import { rewriteChatNotificationPreviews } from "./chat-notification-fanout";

// Uses a dedicated disposable database and minimal tables. Tests actual
// Prisma/PostgreSQL locking, but does not validate production migrations.
const databaseUrl = databaseUrlFor("preview-control");
let ownsType = false;
let ownsMessages = false;
let ownsNotifications = false;
const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const NOTIFICATION_ID = "preview-lock-notification";
const control = databaseUrl ? createPrismaClient(databaseUrl) : null;
const writer = databaseUrl
  ? createPrismaClient(databaseUrlFor("preview-writer")!)
  : null;
const observer = databaseUrl
  ? createPrismaClient(databaseUrlFor("preview-observer")!)
  : null;
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitsForLock(application: string) {
  const rows = await observer!.$queryRaw<Array<{ waiting: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
      WHERE application_name = ${application} AND wait_event_type = 'Lock') AS waiting
  `;
  return rows[0]?.waiting;
}
async function storedPreview() {
  const rows = await observer!.$queryRaw<Array<{ messageParams: string }>>`
    SELECT "messageParams" FROM notification WHERE id = ${NOTIFICATION_ID}
  `;
  return JSON.parse(rows[0]!.messageParams).messagePreview;
}
describe.skipIf(!databaseUrl)(
  "chat notification preview PostgreSQL locking",
  () => {
    beforeAll(async () => {
      await control!.$executeRawUnsafe(
        `CREATE TYPE "NotificationKind" AS ENUM ('JOB', 'TASK', 'BILLING', 'SYSTEM', 'CHAT')`,
      );
      ownsType = true;
      await control!.$executeRawUnsafe(`CREATE TABLE chat_room_message (
      id uuid PRIMARY KEY, "roomId" uuid NOT NULL, content text NOT NULL, "deletedAt" timestamp
    )`);
      ownsMessages = true;
      await control!.$executeRawUnsafe(`CREATE TABLE notification (
      id text PRIMARY KEY, kind "NotificationKind" NOT NULL, "referenceId" text NOT NULL,
      "messageParams" text NOT NULL, metadata text
    )`);
      ownsNotifications = true;
      await control!.$executeRaw`
      INSERT INTO chat_room_message (id, "roomId", content)
      VALUES (${MESSAGE_ID}::uuid, ${ROOM_ID}::uuid, 'original')
    `;
      await control!.$executeRaw`
      INSERT INTO notification (id, kind, "referenceId", "messageParams", metadata)
      VALUES (${NOTIFICATION_ID}, 'CHAT', ${ROOM_ID}, '{}', ${JSON.stringify({ messageId: MESSAGE_ID })})
    `;
    });
    beforeEach(async () => {
      captureException.mockClear();
      await control!
        .$executeRaw`UPDATE chat_room_message SET content = 'original', "deletedAt" = NULL`;
      await control!.$executeRaw`
      UPDATE notification SET "messageParams" = ${JSON.stringify({ messagePreview: "original", count: 2 })}
    `;
    });
    afterAll(async () => {
      if (control) {
        if (ownsNotifications)
          await control.$executeRawUnsafe("DROP TABLE notification");
        if (ownsMessages)
          await control.$executeRawUnsafe("DROP TABLE chat_room_message");
        if (ownsType)
          await control.$executeRawUnsafe('DROP TYPE "NotificationKind"');
      }
      await Promise.all([
        prisma.$disconnect(),
        control?.$disconnect(),
        writer?.$disconnect(),
        observer?.$disconnect(),
      ]);
    });
    it("uses committed content when an older edit callback runs last", async () => {
      await writer!
        .$executeRaw`UPDATE chat_room_message SET content = 'latest edit B'`;
      await rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      });
      await rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      });
      expect(await storedPreview()).toBe("latest edit B");
      expect(captureException).not.toHaveBeenCalled();
    });
    it.each(["edit", "delete"])(
      "holds the message lock through the sweep before a competing %s",
      async (operation) => {
        const locked = deferred();
        const release = deferred();
        const blocker = control!.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM notification WHERE id = ${NOTIFICATION_ID} FOR UPDATE`;
            locked.resolve();
            await release.promise;
          },
          { timeout: 10_000 },
        );
        await locked.promise;
        const rewrite = rewriteChatNotificationPreviews({
          roomId: ROOM_ID,
          messageId: MESSAGE_ID,
        });
        let mutation: Promise<unknown> | undefined;
        try {
          await expect
            .poll(() => waitsForLock("preview-rewrite"), { timeout: 2_000 })
            .toBe(true);
          mutation =
            operation === "edit"
              ? writer!
                  .$executeRaw`UPDATE chat_room_message SET content = 'latest edit B'`.then(
                  (result) => result,
                )
              : writer!
                  .$executeRaw`UPDATE chat_room_message SET content = '', "deletedAt" = NOW()`.then(
                  (result) => result,
                );
          await expect
            .poll(() => waitsForLock("preview-writer"), { timeout: 2_000 })
            .toBe(true);
        } finally {
          release.resolve();
          await blocker;
          await rewrite;
          await mutation;
        }
        await rewriteChatNotificationPreviews({
          roomId: ROOM_ID,
          messageId: MESSAGE_ID,
        });
        expect(await storedPreview()).toBe(
          operation === "edit" ? "latest edit B" : undefined,
        );
        expect(captureException).not.toHaveBeenCalled();
      },
    );
    it("rewrites 100 recipient rows", async () => {
      await control!.$executeRaw`
      INSERT INTO notification (id, kind, "referenceId", "messageParams", metadata)
      SELECT 'recipient-' || n, 'CHAT', ${ROOM_ID}, ${JSON.stringify({ messagePreview: "original" })},
        ${JSON.stringify({ messageId: MESSAGE_ID })} FROM generate_series(1, 99) AS n
    `;
      await writer!
        .$executeRaw`UPDATE chat_room_message SET content = 'latest edit B'`;
      await rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      });
      const rows = await observer!.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM notification
      WHERE "messageParams"::jsonb->>'messagePreview' = 'latest edit B'
    `;
      expect(rows[0]?.count).toBe(100n);
      expect(captureException).not.toHaveBeenCalled();
    });
  },
);
