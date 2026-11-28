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
  organizationContextMiddleware: async (
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

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { errorHandler } from "@/helpers/error-handler";
import { NETWORK_HEADER } from "@/middleware/network-scope";
import { createNestedOpenAPIHono, OpenAPIHonoWithAuth } from "./hono";

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

  it("gives every request a Mainnet Network scope", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.get("/", (c) => c.text(c.var.networkScope.network));

    const response = await app.request("http://localhost/");

    expect(await response.text()).toBe("mainnet");
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

  it("keeps the request's one Network scope under a nested authed router", async () => {
    const scopes: unknown[] = [];
    const parent = new OpenAPIHonoWithAuth();
    parent.use(async (c, next) => {
      scopes.push(c.var.networkScope);
      await next();
    });
    const child = new OpenAPIHonoWithAuth();
    child.get("/files", (c) => {
      scopes.push(c.var.networkScope);
      return c.body(null);
    });
    parent.route("/drive", child);

    await parent.request("http://localhost/drive/files");

    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBeDefined();
    expect(scopes[1]).toBe(scopes[0]);
  });

  it("preserves parent workspaceContext on a nested remount without auth", async () => {
    const parent = new OpenAPIHonoWithAuth({
      includeWorkspaceContext: true,
    });
    const child = createNestedOpenAPIHono();
    child.get("/files", (c) => {
      return c.json({
        workspaceContext: c.var.workspaceContext,
      });
    });
    parent.route("/drive", child);

    const response = await parent.request("http://localhost/drive/files");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
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

  it("refuses Preprod right after auth when mainnetOnly is enabled, before context/org/workspace middleware", async () => {
    const app = new OpenAPIHonoWithAuth({
      includeWorkspaceContext: true,
      mainnetOnly: true,
    });
    app.onError(errorHandler);
    app.get("/feature", (c) => c.json({ ok: true }));

    const preprod = await app.request("http://localhost/feature", {
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(preprod.status).toBe(422);
    expect(await preprod.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
      message: "This feature is available on Mainnet only.",
    });
    expect(middlewareCalls.calls).toEqual(["auth"]);

    middlewareCalls.calls.length = 0;
    const mainnet = await app.request("http://localhost/feature");
    expect(mainnet.status).toBe(200);
    expect(middlewareCalls.calls).toEqual([
      "auth",
      "context",
      "organization",
      "workspace",
    ]);
  });

  it("refuses Preprod only for matching path/method rules on a mixed router", async () => {
    const app = new OpenAPIHonoWithAuth({
      includeWorkspaceContext: true,
      mainnetOnly: [
        "/:id/competitors",
        "/:id/competitors/*",
        { path: "/:id/find", methods: ["POST"] },
      ],
    });
    app.onError(errorHandler);
    app.get("/:id", (c) => c.json({ ok: "shared" }));
    app.get("/:id/competitors", (c) => c.json({ ok: "competitors" }));
    app.post("/:id/competitors/check", (c) => c.json({ ok: "check" }));
    app.get("/:id/find", (c) => c.json({ ok: "get-find" }));
    app.post("/:id/find", (c) => c.json({ ok: "post-find" }));

    const shared = await app.request("http://localhost/p1", {
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(shared.status).toBe(200);

    const getFind = await app.request("http://localhost/p1/find", {
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(getFind.status).toBe(200);

    for (const [method, path] of [
      ["GET", "/p1/competitors"],
      ["POST", "/p1/competitors/check"],
      ["POST", "/p1/find"],
    ] as const) {
      middlewareCalls.calls.length = 0;
      const res = await app.request(`http://localhost${path}`, {
        method,
        headers: { [NETWORK_HEADER]: "preprod" },
      });
      expect(res.status).toBe(422);
      expect(middlewareCalls.calls).toEqual(["auth"]);
    }
  });
});
