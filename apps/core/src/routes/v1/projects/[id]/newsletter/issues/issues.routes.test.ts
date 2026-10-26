import { OpenAPIHono } from "@hono/zod-openapi";
import type { NewsletterIssue } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER,
  NEWSLETTER_ID,
  NEWSLETTER_ISSUE,
  NEWSLETTER_ISSUE_ID,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

import mountDelete from "./[issueId]/delete";
import mountGet from "./[issueId]/get";
import mountPatch from "./[issueId]/patch";
import mountList from "./get";
import mountCreate from "./post";

const m = vi.hoisted(() => ({
  enabled: true,
  workspace: vi.fn(),
  project: vi.fn(),
  newsletter: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: m.workspace },
    project: { findFirst: m.project },
    newsletter: { findUnique: m.newsletter },
    newsletterIssue: {
      findUnique: m.findUnique,
      findUniqueOrThrow: m.findUniqueOrThrow,
      findMany: m.findMany,
      count: m.count,
      create: m.create,
      updateMany: m.updateMany,
      deleteMany: m.deleteMany,
    },
    $transaction: m.transaction,
  },
}));

const BASE = `http://localhost/${NEWSLETTER_PROJECT_ID}/newsletter/issues`;
const INPUT = {
  subject: "Hello readers",
  template: "TEXT",
  content: [{ type: "text", text: "News" }],
};

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function app(authenticated = true) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    if (!authenticated) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId: NEWSLETTER_WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
    });
    await next();
  });
  mountList(app);
  mountCreate(app);
  mountGet(app);
  mountPatch(app);
  mountDelete(app);
  app.onError(errorHandler);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.workspace.mockResolvedValue({ organization: { slug: "utxo" } });
  m.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    closingAt: null,
    closedAt: null,
  });
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.findUnique.mockResolvedValue(NEWSLETTER_ISSUE);
  m.findUniqueOrThrow.mockResolvedValue({
    ...NEWSLETTER_ISSUE,
    revision: 1,
    subject: "Updated",
  });
  m.findMany.mockResolvedValue([NEWSLETTER_ISSUE]);
  m.count.mockResolvedValue(1);
  m.create.mockResolvedValue(NEWSLETTER_ISSUE);
  m.updateMany.mockResolvedValue({ count: 1 });
  m.deleteMany.mockResolvedValue({ count: 1 });
  const tx = {
    newsletterIssue: {
      updateMany: m.updateMany,
      findUniqueOrThrow: m.findUniqueOrThrow,
    },
  };
  m.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});

describe("newsletter issue routes", () => {
  it("lists by status with pagination inside the workspace and newsletter", async () => {
    const response = await app().request(`${BASE}?status=DRAFT`);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: NEWSLETTER_PROJECT_ID,
          workspaceId: NEWSLETTER_WORKSPACE_ID,
          newsletterId: NEWSLETTER_ID,
          status: "DRAFT",
        },
      }),
    );
  });

  it("creates a draft with validated blocks and a public subject slug", async () => {
    expect((await app().request(BASE, json("POST", INPUT))).status).toBe(201);
    expect(m.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ...INPUT,
        newsletterId: NEWSLETTER_ID,
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        publicSlug: expect.stringMatching(/^hello-readers-[a-f0-9]{8}$/),
      }),
    });
  });

  it("gets a scoped issue and leaves worker lease fields private", async () => {
    const response = await app().request(`${BASE}/${NEWSLETTER_ISSUE_ID}`);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.id).toBe(NEWSLETTER_ISSUE_ID);
    expect(data).not.toHaveProperty("leaseToken");
    expect(m.findUnique).toHaveBeenCalledWith({
      where: {
        id: NEWSLETTER_ISSUE_ID,
        newsletterId: NEWSLETTER_ID,
        projectId: NEWSLETTER_PROJECT_ID,
        workspaceId: NEWSLETTER_WORKSPACE_ID,
      },
    });
  });

  it.each(["DRAFT", "NEEDS_APPROVAL"] as const)(
    "edits %s with revision fencing and returns to DRAFT",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...NEWSLETTER_ISSUE, status });
      const response = await app().request(
        `${BASE}/${NEWSLETTER_ISSUE_ID}`,
        json("PATCH", { subject: "Updated", revision: 0 }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        status: "DRAFT",
        revision: 1,
      });
      expect(m.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: NEWSLETTER_ISSUE_ID,
          revision: 0,
          status: { in: ["DRAFT", "NEEDS_APPROVAL"] },
        }),
        data: {
          subject: "Updated",
          status: "DRAFT",
          revision: { increment: 1 },
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    },
  );

  it.each([
    "SCHEDULED",
    "SENDING",
    "SENT",
    "FAILED",
    "CANCELED",
  ] satisfies NewsletterIssue["status"][])(
    "refuses editing %s",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...NEWSLETTER_ISSUE, status });
      expect(
        (
          await app().request(
            `${BASE}/${NEWSLETTER_ISSUE_ID}`,
            json("PATCH", { subject: "Updated", revision: 0 }),
          )
        ).status,
      ).toBe(409);
      expect(m.updateMany).not.toHaveBeenCalled();
    },
  );

  it("returns 409 for a stale revision and a race lost during the update", async () => {
    expect(
      (
        await app().request(
          `${BASE}/${NEWSLETTER_ISSUE_ID}`,
          json("PATCH", { subject: "Updated", revision: 1 }),
        )
      ).status,
    ).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled();
    m.updateMany.mockResolvedValue({ count: 0 });
    expect(
      (
        await app().request(
          `${BASE}/${NEWSLETTER_ISSUE_ID}`,
          json("PATCH", { subject: "Updated", revision: 0 }),
        )
      ).status,
    ).toBe(409);
  });

  it.each(["DRAFT", "CANCELED"] as const)(
    "deletes %s with a status guard",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...NEWSLETTER_ISSUE, status });
      expect(
        (
          await app().request(`${BASE}/${NEWSLETTER_ISSUE_ID}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(204);
      expect(m.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "CANCELED"] },
          revision: 0,
        }),
      });
    },
  );

  it("refuses deleting an issue that changed status", async () => {
    m.deleteMany.mockResolvedValue({ count: 0 });
    expect(
      (
        await app().request(`${BASE}/${NEWSLETTER_ISSUE_ID}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
  });

  it.each([
    "NEEDS_APPROVAL",
    "SCHEDULED",
    "SENDING",
    "SENT",
    "FAILED",
  ] as const)("refuses deleting %s", async (status) => {
    m.findUnique.mockResolvedValue({ ...NEWSLETTER_ISSUE, status });
    expect(
      (
        await app().request(`${BASE}/${NEWSLETTER_ISSUE_ID}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an issue outside this newsletter", async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await app().request(`${BASE}/${NEWSLETTER_ISSUE_ID}`)).status).toBe(
      404,
    );
  });

  it.each([
    { ...INPUT, content: [{ type: "heading", text: "Bad", level: 3 }] },
    {
      ...INPUT,
      content: [{ type: "button", label: "Bad", url: "http://example.com" }],
    },
    { ...INPUT, template: "OTHER" },
  ])("rejects invalid issue content", async (input) => {
    expect((await app().request(BASE, json("POST", input))).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("requires a revision and content for PATCH", async () => {
    for (const input of [{ subject: "Updated" }, { revision: 0 }]) {
      expect(
        (
          await app().request(
            `${BASE}/${NEWSLETTER_ISSUE_ID}`,
            json("PATCH", input),
          )
        ).status,
      ).toBe(422);
    }
  });

  it("hides every operation while disabled", async () => {
    m.enabled = false;
    const server = app();
    const requests = [
      server.request(BASE),
      server.request(BASE, json("POST", INPUT)),
      server.request(`${BASE}/${NEWSLETTER_ISSUE_ID}`),
      server.request(
        `${BASE}/${NEWSLETTER_ISSUE_ID}`,
        json("PATCH", { subject: "Updated", revision: 0 }),
      ),
      server.request(`${BASE}/${NEWSLETTER_ISSUE_ID}`, { method: "DELETE" }),
    ];
    expect(
      (await Promise.all(requests)).map((response) => response.status),
    ).toEqual([404, 404, 404, 404, 404]);
    expect(m.project).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("rejects unauthorized and inaccessible project requests", async () => {
    expect((await app(false).request(BASE)).status).toBe(401);
    m.project.mockResolvedValue(null);
    expect((await app().request(BASE)).status).toBe(404);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it.each([{ organization: { slug: "other" } }, { organization: null }, null])(
    "hides every operation outside the beta workspace: %j",
    async (workspace) => {
      m.workspace.mockResolvedValue(workspace);
      const server = app();
      const responses = await Promise.all([
        server.request(BASE),
        server.request(BASE, json("POST", INPUT)),
        server.request(`${BASE}/${NEWSLETTER_ISSUE_ID}`),
        server.request(
          `${BASE}/${NEWSLETTER_ISSUE_ID}`,
          json("PATCH", { subject: "Updated", revision: 0 }),
        ),
        server.request(`${BASE}/${NEWSLETTER_ISSUE_ID}`, { method: "DELETE" }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([
        404, 404, 404, 404, 404,
      ]);
      expect(m.project).not.toHaveBeenCalled();
      expect(m.findMany).not.toHaveBeenCalled();
      expect(m.findUnique).not.toHaveBeenCalled();
      expect(m.create).not.toHaveBeenCalled();
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.deleteMany).not.toHaveBeenCalled();
    },
  );
});
