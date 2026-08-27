import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostOrchestratorMePurge from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { captureExceptionMock, clearHermesLocalMirrorForUserMock } = vi.hoisted(
  () => ({
    captureExceptionMock: vi.fn(),
    clearHermesLocalMirrorForUserMock: vi.fn(),
  }),
);

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/helpers/orchestrator-instance", () => ({
  clearHermesLocalMirrorForUser: (...args: unknown[]) =>
    clearHermesLocalMirrorForUserMock(...args),
}));

function createApp(actor: "orchestrator" | "user" = "orchestrator") {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    if (actor === "orchestrator") {
      c.set("authContext", { actor: "orchestrator" });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      });
    }
    return await next();
  });

  mountPostOrchestratorMePurge(app);
  return app;
}

describe("POST /orchestrators/me/purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearHermesLocalMirrorForUserMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for user session credentials", async () => {
    const response = await createApp("user").request("/me/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_gone" }),
    });

    expect(response.status).toBe(403);
    expect(clearHermesLocalMirrorForUserMock).not.toHaveBeenCalled();
  });

  it("returns 422 when userId is missing", async () => {
    const response = await createApp().request("/me/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    expect(clearHermesLocalMirrorForUserMock).not.toHaveBeenCalled();
  });

  it("purges local state for the body userId", async () => {
    const response = await createApp().request("/me/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_gone" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ purged: true, userId: "user_gone" });
    expect(clearHermesLocalMirrorForUserMock).toHaveBeenCalledWith("user_gone");
  });

  it("is idempotent on a second purge", async () => {
    const app = createApp();
    for (let i = 0; i < 2; i++) {
      const response = await app.request("/me/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user_gone" }),
      });
      expect(response.status).toBe(200);
    }
    expect(clearHermesLocalMirrorForUserMock).toHaveBeenCalledTimes(2);
  });

  it("returns 503 with a retry-safe message when purge fails", async () => {
    const failure = new Error("db down");
    clearHermesLocalMirrorForUserMock.mockRejectedValueOnce(failure);

    const response = await createApp().request("/me/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_gone" }),
    });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      "Failed to purge local assistant state. Retrying is safe.",
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(failure, {
      tags: { context: "orchestrator_purge" },
      extra: { userId: "user_gone" },
    });
  });
});
