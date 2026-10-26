import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const queries: string[] = [];
const originalQuery = pg.Pool.prototype.query;
function sqlText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }
  return null;
}
pg.Pool.prototype.query = function query(
  this: pg.Pool,
  ...args: Parameters<typeof originalQuery>
) {
  const text = sqlText(args[0]);
  if (text) queries.push(text);
  return originalQuery.apply(this, args);
} as typeof originalQuery;

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const roomId = randomUUID();
const ROW_COUNT = 4;
const projectIds = Array.from({ length: ROW_COUNT }, () => randomUUID());
const postIds = Array.from({ length: ROW_COUNT }, () => randomUUID());
const messageIds = Array.from({ length: ROW_COUNT }, () => randomUUID());

function count(predicate: (sql: string) => boolean): number {
  return queries.filter(predicate).length;
}

describe.skipIf(!enabled)(
  "GET /chats/rooms/:id/message-results workspace query count",
  () => {
    beforeAll(async () => {
      const { default: prisma } = await import("@/lib/db/prisma");
      await prisma.user.create({
        data: {
          id: userId,
          name: "Message results fixture",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      });
      await prisma.project.createMany({
        data: projectIds.map((id, index) => ({
          id,
          workspaceId,
          name: `Result project ${index}`,
        })),
      });
      await prisma.socialPost.createMany({
        data: postIds.map((id, index) => ({
          id,
          projectId: projectIds[index]!,
          workspaceId,
          provider: "x",
          text: `Post ${index}`,
          media: [],
          creatorUserId: userId,
        })),
      });
      await prisma.chatRoom.create({
        data: {
          id: roomId,
          name: "Results",
          kind: "direct",
          directKey: `direct:repro:${roomId}`,
          createdByUserId: userId,
          userMembers: { create: { userId } },
        },
      });
      await prisma.chatRoomMessage.createMany({
        data: messageIds.map((id, index) => ({
          id,
          roomId,
          senderUserId: userId,
          content: `result ${index}`,
          metadata: {
            result_preview_snapshots: [
              {
                workspaceId,
                reference: {
                  kind: "social_post",
                  id: postIds[index],
                  projectId: projectIds[index],
                },
                data: {
                  id: randomUUID(),
                  state: "available",
                  capturedAt: new Date().toISOString(),
                  kind: "social_post",
                  title: `Post ${index}`,
                  status: "DRAFT",
                  sourceHref: `/social?projectId=${projectIds[index]}&postId=${postIds[index]}`,
                },
              },
            ],
          },
        })),
      });
    });

    afterAll(async () => {
      const { default: prisma } = await import("@/lib/db/prisma");
      await prisma.chatRoom.deleteMany({ where: { id: roomId } });
      await prisma.socialPost.deleteMany({ where: { workspaceId } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("loads each shared workspace once for a page of social post results", async () => {
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const { default: mount } = await import("./get");
      const app = new OpenAPIHonoWithAuth();
      app.use("*", async (c, next) => {
        c.set("requestId", "message-results-n-plus-one");
        c.set("isAuthenticated", true);
        c.set("authContext", {
          actor: "user",
          userId,
          organizationId: null,
          role: "user",
        });
        await next();
      });
      app.onError((error, c) => c.json({ error: error.message }, 500));
      mount(app);

      queries.length = 0;
      const response = await app.request(
        `http://localhost/${roomId}/message-results?messageIds=${messageIds.join(",")}`,
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.data).toHaveLength(ROW_COUNT);
      expect(
        body.data.every(
          (row: { results: { state: string }[] }) =>
            row.results[0]?.state === "available",
        ),
      ).toBe(true);

      expect(
        count(
          (sql) =>
            sql.includes('"public"."workspace"."userId"') &&
            sql.includes('"public"."workspace"."organizationId"') &&
            sql.includes(" IN ("),
        ),
      ).toBe(0);
      expect(
        count(
          (sql) =>
            sql.includes('"public"."workspace"') &&
            sql.includes("LEFT JOIN") &&
            sql.includes('"organization"'),
        ),
      ).toBe(1);
      expect(
        count(
          (sql) =>
            sql.includes('"public"."project"') &&
            sql.includes('"id" = $1') &&
            sql.includes('"workspaceId" = $2'),
        ),
      ).toBe(0);
      expect(count((sql) => sql.includes('"public"."social_post"'))).toBe(1);
      expect(
        count(
          (sql) =>
            sql.includes('"public"."file_resource"') && sql.includes("1=0"),
        ),
      ).toBe(0);
    });
  },
);
