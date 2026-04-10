import { beforeEach, describe, expect, it, vi } from "vitest";

const middlewareCalls = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("@/middleware/auth", () => ({
  authMiddleware: async (
    c: {
      set: (key: string, value: unknown) => void;
    },
    next: () => Promise<void>,
  ) => {
    middlewareCalls.calls.push("auth");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
    await next();
  },
}));

vi.mock("@/middleware/organization", () => ({
  organizationHeaderMiddleware: async (
    c: {
      set: (key: string, value: unknown) => void;
      var: {
        authContext: {
          actor: "user";
          userId: string;
          organizationId: string | null;
        };
      };
    },
    next: () => Promise<void>,
  ) => {
    middlewareCalls.calls.push("organization");
    c.set("authContext", {
      ...c.var.authContext,
      organizationId: "org_123",
    });
    await next();
  },
}));

vi.mock("@/middleware/workspace-context", () => ({
  workspaceContextMiddleware: async (
    c: {
      set: (key: string, value: unknown) => void;
      var: {
        authContext: {
          actor: "user";
          userId: string;
          organizationId: string | null;
        };
      };
    },
    next: () => Promise<void>,
  ) => {
    middlewareCalls.calls.push("workspace");
    c.set("workspaceContext", {
      workspaceId: "workspace_123",
      userId: c.var.authContext.userId,
      organizationId: c.var.authContext.organizationId,
    });
    await next();
  },
}));

import { OpenAPIHonoWithAuth } from "./hono";

describe("OpenAPIHonoWithAuth", () => {
  beforeEach(() => {
    middlewareCalls.calls.length = 0;
  });

  it("does not resolve workspaceContext by default", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.get("/", (c) => {
      return c.json({
        authContext: c.var.authContext,
        workspaceContext: c.var.workspaceContext,
      });
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      workspaceContext: null,
    });
    expect(middlewareCalls.calls).toEqual(["auth", "organization"]);
  });

  it("resolves workspaceContext when includeWorkspaceContext is enabled", async () => {
    const app = new OpenAPIHonoWithAuth({
      includeWorkspaceContext: true,
    });
    app.get("/", (c) => {
      return c.json({
        authContext: c.var.authContext,
        workspaceContext: c.var.workspaceContext,
      });
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      workspaceContext: {
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      },
    });
    expect(middlewareCalls.calls).toEqual([
      "auth",
      "organization",
      "workspace",
    ]);
  });
});
