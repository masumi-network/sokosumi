import { OpenAPIHono } from "@hono/zod-openapi";
import type { NewsletterIssue } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
  newsletterWorkspace,
} from "@/test/newsletter";
import mountApprove from "./[issueId]/approve/post";
import mountCancel from "./[issueId]/cancel/post";
import mountPatch from "./[issueId]/patch";
import mountSchedule from "./[issueId]/schedule/post";
import mountSendNow from "./[issueId]/send-now/post";
import mountSubmit from "./[issueId]/submit/post";

const m = vi.hoisted(() => ({
  users: vi.fn(),
  enabled: true,
  workspace: vi.fn(),
  domain: "news.example.com",
  authorized: true,
  project: vi.fn(),
  newsletter: vi.fn(),
  issue: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  read: vi.fn(),
  createTask: vi.fn(),
  task: vi.fn(),
  taskUpdate: vi.fn(),
  taskMetadata: vi.fn(),
  event: vi.fn(),
  subscribers: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NEWSLETTER_ENABLED: m.enabled,
      NEWSLETTER_FROM_DOMAIN: m.domain || undefined,
    }),
  };
});
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: async () => {
    if (!m.authorized) throw forbidden("Workspace access denied");
    return { userId: "user_1", organizationId: null };
  },
}));
vi.mock("@/services/task-domain.service", () => ({
  createTaskForActor: m.createTask,
}));
vi.mock("@/services/newsletter-send.service", () => ({
  sendNewsletterIssue: m.send,
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/db/prisma", () => {
  const tx = {
    newsletterIssue: {
      updateMany: m.updateMany,
      update: m.update,
      findUniqueOrThrow: m.read,
    },
    newsletterSubscriber: { count: m.subscribers },
    task: {
      findFirst: m.task,
      updateMany: m.taskUpdate,
      update: m.taskMetadata,
    },
    taskEvent: { create: m.event },
  };
  return {
    default: {
      workspace: { findUnique: m.workspace },
      ...tx,
      user: { findMany: m.users },
      project: { findFirst: m.project },
      newsletter: { findUnique: m.newsletter },
      newsletterIssue: { ...tx.newsletterIssue, findUnique: m.issue },
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: "vendor_1",
  context: { userId: "user_1", organizationId: null },
};
const BOT: AuthenticationContext = {
  actor: "sokoBot",
  scope: "personal",
  sokoBotId: "66666666-6666-4666-8666-666666666666",
  userId: "user_1",
  organizationId: null,
  workspaceId: NEWSLETTER_WORKSPACE_ID,
};
const BASE = `http://localhost/${NEWSLETTER_PROJECT_ID}/newsletter/issues/${NEWSLETTER_ISSUE.id}`;
const NOW = new Date("2026-10-23T10:00:00Z");
function app(actor: AuthenticationContext = USER) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("authContext", actor);
    c.set("requestId", "newsletter_lifecycle");
    c.set("workspaceContext", {
      workspaceId: NEWSLETTER_WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
    });
    await next();
  });
  [
    mountSubmit,
    mountApprove,
    mountSchedule,
    mountSendNow,
    mountCancel,
    mountPatch,
  ].forEach((mount) => mount(app));
  app.onError(errorHandler);
  return app;
}
function request(
  action: string,
  input: unknown = { revision: 0 },
  actor = USER,
) {
  return app(actor).request(`${BASE}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
function issue(status: NewsletterIssue["status"], approved = false) {
  m.issue.mockResolvedValue({
    ...NEWSLETTER_ISSUE,
    status,
    taskId: "task_1",
    approvedAt: approved ? NOW : null,
    approvedByUserId: approved ? "user_1" : null,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.enabled = true;
  m.workspace.mockResolvedValue(newsletterWorkspace());
  m.domain = "news.example.com";
  m.authorized = true;
  m.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    closingAt: null,
    closedAt: null,
  });
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.users.mockResolvedValue([{ id: "user_1", name: "Ada" }]);
  m.issue.mockResolvedValue(NEWSLETTER_ISSUE);
  m.updateMany.mockResolvedValue({ count: 1 });
  m.read.mockResolvedValue({ ...NEWSLETTER_ISSUE, revision: 1 });
  m.createTask.mockResolvedValue({ id: "task_1" });
  m.task.mockResolvedValue({
    id: "task_1",
    status: "READY",
    name: "Approve newsletter: Hello readers",
  });
  m.taskUpdate.mockResolvedValue({ count: 1 });
  m.subscribers.mockResolvedValue(3);
});
afterEach(() => vi.useRealTimers());

describe("newsletter approval and delivery", () => {
  it.each(["other", null])(
    "hides all lifecycle actions in workspace organization %s",
    async (slug) => {
      m.workspace.mockResolvedValue(newsletterWorkspace(slug));
      for (const action of [
        "submit",
        "approve",
        "schedule",
        "send-now",
        "cancel",
      ]) {
        const input =
          action === "schedule"
            ? {
                revision: 0,
                scheduledAt: "2026-10-24T10:00:00Z",
                timezone: "UTC",
              }
            : { revision: 0 };
        expect((await request(action, input)).status).toBe(404);
      }
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.createTask).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it.each(["other", null])(
    "hides newsletters from shared bots in workspace organization %s",
    async (slug) => {
      m.workspace.mockResolvedValue(newsletterWorkspace(slug));
      const actor: AuthenticationContext = {
        actor: "sokoBot",
        scope: "project",
        sokoBotId: BOT.sokoBotId,
        userId: null,
        organizationId: "org_1",
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        projectId: NEWSLETTER_PROJECT_ID,
      };
      expect((await request("submit", { revision: 0 }, actor)).status).toBe(
        404,
      );
      expect(m.createTask).not.toHaveBeenCalled();
    },
  );

  it.each([USER, COWORKER, BOT])(
    "lets $actor submit and creates its approval Task through the domain service",
    async (actor) => {
      const response = await request("submit", { revision: 0 }, actor);
      expect(response.status).toBe(200);
      expect(m.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
          name: "Approve newsletter: Hello readers",
          status: "READY",
          assigneeUserId: actor.actor === "user" ? "user_1" : null,
          actor: expect.objectContaining({
            kind: actor.actor === "sokoBot" ? "soko_bot" : actor.actor,
          }),
        }),
        expect.anything(),
      );
      expect(m.update).toHaveBeenCalledWith({
        where: { id: NEWSLETTER_ISSUE.id },
        data: { taskId: "task_1" },
      });
      expect(m.send).not.toHaveBeenCalled();
    },
  );
  it("allows a shared project Soko Bot to submit only within its scope", async () => {
    const actor: AuthenticationContext = {
      actor: "sokoBot",
      scope: "project",
      sokoBotId: "66666666-6666-4666-8666-666666666666",
      userId: null,
      organizationId: "org_1",
      workspaceId: NEWSLETTER_WORKSPACE_ID,
      projectId: NEWSLETTER_PROJECT_ID,
    };
    expect((await request("submit", { revision: 0 }, actor)).status).toBe(200);
    expect(m.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: null,
        organizationId: "org_1",
        assigneeUserId: null,
      }),
      expect.anything(),
    );
    m.createTask.mockClear();
    expect(
      (
        await request(
          "submit",
          { revision: 0 },
          { ...actor, projectId: "other_project" },
        )
      ).status,
    ).toBe(403);
    expect(m.createTask).not.toHaveBeenCalled();
  });
  it("updates the approval Task title when an edited issue is resubmitted", async () => {
    issue("DRAFT");
    m.task.mockResolvedValue({
      id: "task_1",
      status: "READY",
      name: "Approve newsletter: Previous subject",
    });
    expect((await request("submit")).status).toBe(200);
    expect(m.taskMetadata).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: {
        name: "Approve newsletter: Hello readers",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: "user_1",
      },
    });
    expect(m.createTask).not.toHaveBeenCalled();
  });
  it.each([USER, COWORKER, BOT])(
    "assigns a reused approval Task to the current human submitter or leaves it unassigned for $actor",
    async (actor) => {
      issue("DRAFT");
      expect((await request("submit", { revision: 0 }, actor)).status).toBe(
        200,
      );
      expect(m.taskMetadata).toHaveBeenCalledWith({
        where: { id: "task_1" },
        data: {
          name: "Approve newsletter: Hello readers",
          assigneeId: null,
          assigneeSokoBotId: null,
          assigneeUserId: actor.actor === "user" ? "user_1" : null,
        },
      });
    },
  );
  it("reuses the approval Task on resubmission", async () => {
    issue("DRAFT");
    expect((await request("submit")).status).toBe(200);
    expect(m.createTask).not.toHaveBeenCalled();
  });
  it("approves only the current issue revision and completes the linked Task with an event", async () => {
    issue("NEEDS_APPROVAL");
    expect((await request("approve")).status).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        revision: 0,
        status: "NEEDS_APPROVAL",
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      }),
      data: {
        approvedAt: NOW,
        approvedByUserId: "user_1",
        revision: { increment: 1 },
      },
    });
    expect(m.taskUpdate).toHaveBeenCalledWith({
      where: { id: "task_1", status: "READY" },
      data: { status: "COMPLETED" },
    });
    expect(m.event).toHaveBeenCalledWith({
      data: {
        taskId: "task_1",
        status: "COMPLETED",
        userId: "user_1",
        channel: "SOKOSUMI",
      },
    });
  });
  it.each([
    COWORKER,
    BOT,
    { ...USER, authenticationMethod: "api_key" as const },
    { ...USER, authenticationMethod: "oauth" as const },
  ])(
    "rejects $actor / $authenticationMethod approval with 403",
    async (actor) => {
      issue("NEEDS_APPROVAL");
      expect((await request("approve", { revision: 0 }, actor)).status).toBe(
        403,
      );
      expect(m.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(["schedule", "send-now"])(
    "requires approval for %s",
    async (action) => {
      issue("NEEDS_APPROVAL");
      const response = await request(action, {
        revision: 0,
        scheduledAt: "2026-10-24T10:00:00Z",
        timezone: "Europe/Berlin",
      });
      expect(response.status).toBe(409);
      expect((await response.json()).kind).toBe("newsletter_approval_required");
      expect(m.send).not.toHaveBeenCalled();
    },
  );
  it("schedules an approved issue with its time zone", async () => {
    issue("NEEDS_APPROVAL", true);
    expect(
      (
        await request("schedule", {
          revision: 0,
          scheduledAt: "2026-10-24T10:00:00Z",
          timezone: "Europe/Berlin",
        })
      ).status,
    ).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "SCHEDULED",
          scheduledAt: new Date("2026-10-24T10:00:00Z"),
          timezone: "Europe/Berlin",
          revision: { increment: 1 },
        },
      }),
    );
    expect(m.subscribers).toHaveBeenCalledWith({
      where: { newsletterId: NEWSLETTER.id, status: "ACTIVE" },
    });
    expect(m.send).not.toHaveBeenCalled();
  });
  it("schedules now and immediately invokes the sender, keeping cron recovery if the attempt throws", async () => {
    issue("NEEDS_APPROVAL", true);
    m.send.mockRejectedValue(new Error("Temporary failure"));
    expect((await request("send-now")).status).toBe(200);
    expect(m.send).toHaveBeenCalledWith(NEWSLETTER_ISSUE.id);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SCHEDULED",
          scheduledAt: NOW,
        }),
      }),
    );
  });
  it.each(["schedule", "send-now"])(
    "refuses %s without active subscribers or a sender domain",
    async (action) => {
      issue("NEEDS_APPROVAL", true);
      const input = {
        revision: 0,
        scheduledAt: "2026-10-24T10:00:00Z",
        timezone: "UTC",
      };
      m.subscribers.mockResolvedValue(0);
      let response = await request(action, input);
      expect(response.status).toBe(409);
      expect((await response.json()).kind).toBe(
        "newsletter_no_active_subscribers",
      );
      m.domain = "";
      response = await request(action, input);
      expect(response.status).toBe(409);
      expect((await response.json()).kind).toBe(
        "newsletter_sender_not_configured",
      );
      expect(m.send).not.toHaveBeenCalled();
    },
  );
  it.each(["2026-10-23T10:00:59Z", "2027-10-23T10:00:01Z"])(
    "rejects scheduledAt outside the permitted range: %s",
    async (scheduledAt) => {
      issue("NEEDS_APPROVAL", true);
      expect(
        (
          await request("schedule", {
            revision: 0,
            scheduledAt,
            timezone: "UTC",
          })
        ).status,
      ).toBe(422);
    },
  );
  it("rejects invalid zones and missing revisions", async () => {
    expect(
      (
        await request("schedule", {
          revision: 0,
          scheduledAt: "2026-10-24T10:00:00Z",
          timezone: "invalid",
        })
      ).status,
    ).toBe(422);
    expect((await request("submit", {})).status).toBe(422);
  });
  it("cancels before SENDING, clears approval, and reopens the Task", async () => {
    issue("SCHEDULED", true);
    m.task.mockResolvedValue({ id: "task_1", status: "COMPLETED" });
    expect((await request("cancel")).status).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SCHEDULED", revision: 0 }),
        data: {
          status: "DRAFT",
          scheduledAt: null,
          timezone: null,
          approvedAt: null,
          approvedByUserId: null,
          revision: { increment: 1 },
        },
      }),
    );
    expect(m.taskUpdate).toHaveBeenCalledWith({
      where: { id: "task_1", status: "COMPLETED" },
      data: { status: "READY" },
    });
    issue("SENDING", true);
    expect((await request("cancel")).status).toBe(409);
  });
  it("editing an approved issue clears approval and reopens its Task", async () => {
    issue("NEEDS_APPROVAL", true);
    m.task.mockResolvedValue({ id: "task_1", status: "COMPLETED" });
    const response = await app().request(BASE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 0, subject: "New subject" }),
    });
    expect(response.status).toBe(200);
    expect(m.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "READY" } }),
    );
  });
  it("rejects stale revisions and races before creating a Task", async () => {
    expect((await request("submit", { revision: 1 })).status).toBe(409);
    m.updateMany.mockResolvedValue({ count: 0 });
    expect((await request("submit")).status).toBe(409);
    expect(m.createTask).not.toHaveBeenCalled();
  });
  it.each(["submit", "approve", "schedule", "send-now", "cancel"])(
    "hides %s behind the flag and project access",
    async (action) => {
      const input = {
        revision: 0,
        scheduledAt: "2026-10-24T10:00:00Z",
        timezone: "UTC",
      };
      m.enabled = false;
      expect((await request(action, input)).status).toBe(404);
      m.enabled = true;
      m.project.mockResolvedValue(null);
      expect((await request(action, input)).status).toBe(404);
      expect(m.updateMany).not.toHaveBeenCalled();
    },
  );
  it("keeps coworker access bound to the workspace", async () => {
    m.authorized = false;
    expect((await request("submit", { revision: 0 }, COWORKER)).status).toBe(
      403,
    );
    expect(m.createTask).not.toHaveBeenCalled();
  });
});
