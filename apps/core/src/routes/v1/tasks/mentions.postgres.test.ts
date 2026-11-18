import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordTaskCommentMentions } from "@/helpers/task-event-mentions";
import { resolveTaskCommentMentionedUserIds } from "@/helpers/task-participants";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTasks from "./get";

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

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const personalWorkspaceIds = [randomUUID(), randomUUID()];
const mentionedTaskId = randomUUID();
const quietTaskId = randomUUID();
const privateTaskId = randomUUID();

function createApp(userId: string) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTasks(app);
  return app;
}

interface Page {
  data: Array<{ id: string; hasUnansweredMention?: boolean }>;
  meta: { pagination: { total: number } };
}

// The whole workspace: a mention is often on a teammate's Task.
async function list(userId: string, query = ""): Promise<Page> {
  const response = await createApp(userId).request(
    `http://localhost/?scope=workspace${query}`,
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as Page;
}

/** The Tasks the list marks for a person, sorted. */
async function markedFor(userId: string): Promise<string[]> {
  const page = await list(userId);
  return page.data
    .filter((task) => task.hasUnansweredMention)
    .map((task) => task.id)
    .sort();
}

/** Stores a comment the way the events route does: event, then mentions. */
async function comment(
  authorUserId: string,
  taskId: string,
  text: string,
  visibility: TaskVisibility = TaskVisibility.PUBLIC,
) {
  await prisma.$transaction(async (tx) => {
    const event = await tx.taskEvent.create({
      data: { taskId, comment: text, userId: authorUserId },
    });
    const mentionedUserIds = await resolveTaskCommentMentionedUserIds(tx, {
      workspaceId,
      comment: text,
      visibility,
      ownerId: bobId,
      excludeUserId: authorUserId,
    });
    await recordTaskCommentMentions(tx, {
      taskId,
      taskEventId: event.id,
      authorUserId,
      mentionedUserIds,
      now: new Date(),
    });
  });
}

// Real Prisma and migrations: the mention table, its write path and the list.
describe.skipIf(!enabled)("GET /tasks unanswered mentions", () => {
  beforeAll(async () => {
    for (const [index, id] of [adaId, bobId].entries()) {
      await prisma.user.create({
        data: {
          id,
          name: "Mention fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: personalWorkspaceIds[index] } },
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId}`,
        createdAt: new Date(),
        members: {
          create: [
            { userId: adaId, role: "owner" },
            { userId: bobId, role: "member" },
          ],
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.task.createMany({
      data: [
        { id: mentionedTaskId, name: "Mentioned" },
        { id: quietTaskId, name: "Quiet" },
        {
          id: privateTaskId,
          name: "Bob's private",
          visibility: TaskVisibility.PRIVATE,
        },
      ].map((task) => ({
        workspaceId,
        status: TaskStatus.READY,
        ownerId: bobId,
        ...task,
      })),
    });
  });

  afterAll(async () => {
    const workspaceIds = [workspaceId, ...personalWorkspaceIds];
    await prisma.task.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adaId, bobId] } } });
    await prisma.$disconnect();
  });

  it("marks a Task for the person a comment names until that person comments", async () => {
    await comment(bobId, mentionedTaskId, `@${adaId} can you check this?`);

    expect(await markedFor(adaId)).toEqual([mentionedTaskId]);
    // The author is not marked by their own comment.
    expect(await markedFor(bobId)).toEqual([]);

    const filtered = await list(adaId, "&unansweredMention=true");
    expect(filtered.data.map((task) => task.id)).toEqual([mentionedTaskId]);
    expect(filtered.meta.pagination.total).toBe(1);

    // Another person's comment is not Ada's answer.
    await comment(bobId, mentionedTaskId, "Any news?");
    expect(await markedFor(adaId)).toEqual([mentionedTaskId]);

    await comment(adaId, mentionedTaskId, "Looks right.");
    expect(await markedFor(adaId)).toEqual([]);
    expect(
      (await list(adaId, "&unansweredMention=true")).meta.pagination.total,
    ).toBe(0);

    // A mention after the answer marks the Task again.
    await comment(bobId, mentionedTaskId, `@${adaId} one more thing`);
    expect(await markedFor(adaId)).toEqual([mentionedTaskId]);
  });

  it("answers a mention and names the other person in one comment", async () => {
    await comment(bobId, quietTaskId, `@${adaId} yours?`);
    await comment(adaId, quietTaskId, `@${bobId} no, yours. @${adaId}`);

    // Ada answered, and her mention of herself is not a mention.
    expect(await markedFor(adaId)).not.toContain(quietTaskId);
    expect(await markedFor(bobId)).toEqual([quietTaskId]);
  });

  it("lists a sub-task whose comment mentions the person", async () => {
    const subtask = await prisma.task.create({
      data: {
        name: "Sub-task",
        workspaceId,
        status: TaskStatus.READY,
        ownerId: bobId,
        parentTaskId: quietTaskId,
        position: 1,
      },
    });
    await comment(bobId, subtask.id, `@${adaId} this part is yours`);

    // The plain list hides sub-tasks; the mention list must not.
    expect((await list(adaId)).data.map((task) => task.id)).not.toContain(
      subtask.id,
    );
    const filtered = await list(adaId, "&unansweredMention=true");
    expect(filtered.data.map((task) => task.id)).toContain(subtask.id);
  });

  it("records no mention on a private Task for a person who cannot open it", async () => {
    await comment(
      bobId,
      privateTaskId,
      `@${adaId} secret`,
      TaskVisibility.PRIVATE,
    );

    expect(
      await prisma.taskEventMention.count({ where: { taskId: privateTaskId } }),
    ).toBe(0);
  });
});
