import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serviceUnavailable, tooManyRequests } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { authMiddleware } from "@/middleware/auth";
import mountRelease from "../leases/delete";
import mountAcquire from "../leases/post";

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock("@/helpers/export-admission", () => ({
  acquireExportLease: mocks.acquire,
  releaseExportLease: mocks.release,
}));
const token = "487c2486-da54-45a5-b178-f21827c9b213";
const owner: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
function appFor(actor: AuthenticationContext) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("authContext", actor);
    await next();
  });
  app.onError(errorHandler);
  mountAcquire(app);
  mountRelease(app);
  return app;
}
function releaseRequest(body: unknown = { token }) {
  return {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acquire.mockResolvedValue({ token, durationMs: 45_000 });
  mocks.release.mockResolvedValue({ released: true });
});
describe("export lease routes", () => {
  it("rejects requests without a session before admission", async () => {
    const app = new OpenAPIHono<EnvVariables>();
    app.use(authMiddleware);
    app.onError(errorHandler);
    mountAcquire(app);
    mountRelease(app);
    expect((await app.request("/leases", { method: "POST" })).status).toBe(401);
    expect((await app.request("/leases", releaseRequest())).status).toBe(401);
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("takes the user from the session and keeps the token out of URLs", async () => {
    const app = appFor(owner);
    const response = await app.request("/leases", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { token, durationMs: 45_000 },
    });
    expect(mocks.acquire).toHaveBeenCalledWith("owner");
    const released = await app.request("/leases", releaseRequest());
    expect(released.status).toBe(200);
    expect(mocks.release).toHaveBeenCalledWith("owner", token);
  });
  it.each<AuthenticationContext>([
    { ...owner, authenticationMethod: "api_key" },
    { ...owner, authenticationMethod: "oauth" },
    {
      actor: "coworker",
      coworkerId: "worker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    },
    {
      actor: "sokoBot",
      sokoBotId: "bot",
      userId: "owner",
      workspaceId: "workspace",
      organizationId: null,
    },
  ])("rejects non-interactive actors: %j", async (actor) => {
    const app = appFor(actor);
    expect((await app.request("/leases", { method: "POST" })).status).toBe(403);
    expect((await app.request("/leases", releaseRequest())).status).toBe(403);
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it.each([{ token: "invalid" }, { token, userId: "other" }, {}])(
    "rejects malformed release %j",
    async (body) => {
      expect(
        (await appFor(owner).request("/leases", releaseRequest(body))).status,
      ).toBe(422);
      expect(mocks.release).not.toHaveBeenCalled();
    },
  );
  it("preserves admission failure status", async () => {
    mocks.acquire.mockRejectedValue(
      tooManyRequests("limit", { retryAfterSeconds: 10 }),
    );
    const denied = await appFor(owner).request("/leases", { method: "POST" });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("10");
    mocks.acquire.mockRejectedValue(serviceUnavailable("unavailable"));
    expect(
      (await appFor(owner).request("/leases", { method: "POST" })).status,
    ).toBe(503);
  });
});
