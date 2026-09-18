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
      role: "user",
    });
    await next();
  },
}));

vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    middlewareCalls.calls.push("context");
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
          role: string;
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

vi.mock("@/middleware/workspace", () => ({
  workspaceMiddleware:
    (includeWorkspaceContext: boolean) =>
    async (
      c: {
        set: (key: string, value: unknown) => void;
        var: {
          authContext: {
            actor: "user";
            userId: string;
            organizationId: string | null;
            role: string;
          };
        };
      },
      next: () => Promise<void>,
    ) => {
      if (includeWorkspaceContext) {
        middlewareCalls.calls.push("workspace");
        c.set("workspaceContext", {
          workspaceId: "workspace_123",
          userId: c.var.authContext.userId,
          organizationId: c.var.authContext.organizationId,
        });
      } else {
        c.set("workspaceContext", null);
      }
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
        role: "user",
      },
      workspaceContext: null,
    });
    expect(middlewareCalls.calls).toEqual(["auth", "context", "organization"]);
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
        role: "user",
      },
      workspaceContext: {
        workspaceId: "workspace_123",
        userId: "user_123",
        organizationId: "org_123",
      },
    });
    expect(middlewareCalls.calls).toEqual([
      "auth",
      "context",
      "organization",
      "workspace",
    ]);
  });
});
