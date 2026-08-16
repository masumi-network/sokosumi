import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostProject from "./post.js";

const { projectCreateMock } = vi.hoisted(() => ({
  projectCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      create: projectCreateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  mountPostProject(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a project and returns it", async () => {
    projectCreateMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: WORKSPACE_CONTEXT.workspaceId,
      name: "Alpha",
      websiteUrl: null,
      logo: null,
      designMdUrl: null,
      designMdExtractionId: null,
      briefing: null,
      briefingUrl: null,
      contextMd: null,
      contextMdUrl: null,
      contextMdUpdatedAt: null,
      contextMdModel: null,
      contextMdUpdatingSince: null,
      contextMdVersion: 0,
      createdAt: new Date("2026-04-02T12:00:00.000Z"),
      updatedAt: new Date("2026-04-02T12:00:00.000Z"),
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.data.name).toBe("Alpha");
    expect(projectCreateMock).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        name: "Alpha",
        websiteUrl: null,
        logo: null,
        designMdUrl: null,
        designMdExtractionId: null,
        briefing: null,
      },
    });
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const coworkerAuth: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_123", organizationId: null },
    };

    const app = createApp(coworkerAuth);
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hijack" }),
    });

    expect(res.status).toBe(403);
    expect(projectCreateMock).not.toHaveBeenCalled();
  });

  it("persists project brand fields", async () => {
    const logo =
      "https://abc.public.blob.vercel-storage.com/projects/project_123/logos/hash.png";
    const designMdUrl =
      "https://abc.public.blob.vercel-storage.com/design-md/projects/project_123/hash.md";
    projectCreateMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: WORKSPACE_CONTEXT.workspaceId,
      name: "Branded",
      websiteUrl: "https://example.com",
      logo,
      designMdUrl,
      designMdExtractionId: "extract_123",
      briefing: null,
      briefingUrl: null,
      contextMd: null,
      contextMdUrl: null,
      contextMdUpdatedAt: null,
      contextMdModel: null,
      contextMdUpdatingSince: null,
      contextMdVersion: 0,
      createdAt: new Date("2026-04-02T12:00:00.000Z"),
      updatedAt: new Date("2026-04-02T12:00:00.000Z"),
    });

    const res = await createApp().request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Branded",
        websiteUrl: "https://example.com",
        logo,
        designMd: { url: designMdUrl, extractionId: "extract_123" },
      }),
    });

    expect(res.status).toBe(201);
    expect(projectCreateMock).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        name: "Branded",
        briefing: null,
        websiteUrl: "https://example.com",
        logo,
        designMdUrl,
        designMdExtractionId: "extract_123",
      },
    });
  });
});
