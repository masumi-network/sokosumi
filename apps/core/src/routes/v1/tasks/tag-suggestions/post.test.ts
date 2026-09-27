import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
const mocks = vi.hoisted(() => ({ suggest: vi.fn(), seat: vi.fn() }));
vi.mock("@/services/task-tag-suggestions.service", () => ({
  suggestTaskTags: mocks.suggest,
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: mocks.seat,
}));
const user: AuthenticationContext = {
  actor: "user",
  userId: "user",
  organizationId: "org",
  role: "user",
  authenticationMethod: "session",
};
const input = {
  description:
    "Research competitors and prepare a detailed market analysis report",
};
function app(auth = user, workspace = true) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    if (workspace)
      c.set("workspaceContext", {
        workspaceId: "workspace",
        userId: null,
        organizationId: "org",
      });
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}
function request(body: unknown = input, application = app()) {
  return application.request("http://localhost/tag-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.suggest.mockResolvedValue({ tags: [], receipt: "receipt" });
});
describe("POST /tasks/tag-suggestions", () => {
  it("scopes successful empty suggestions to the session and workspace", async () => {
    const result = await request();
    expect(result.status).toBe(200);
    expect(mocks.seat).toHaveBeenCalledWith("user", "org");
    expect(mocks.suggest).toHaveBeenCalledWith(
      { userId: "user", workspaceId: "workspace" },
      input,
    );
  });
  it.each(["api_key", "oauth"] as const)(
    "rejects %s credentials",
    async (authenticationMethod) => {
      expect(
        (await request(input, app({ ...user, authenticationMethod }))).status,
      ).toBe(403);
      expect(mocks.suggest).not.toHaveBeenCalled();
    },
  );
  it("rejects contextual coworker impersonation", async () => {
    const auth: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "user", organizationId: "org" },
    };
    expect((await request(input, app(auth))).status).toBe(403);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("checks assigned seat before inference", async () => {
    mocks.seat.mockRejectedValue(forbidden("Seat required"));
    expect((await request()).status).toBe(403);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("requires workspace context", async () => {
    expect((await request(input, app(user, false))).status).not.toBe(200);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it.each([
    { name: "tiny" },
    { name: "x".repeat(301) },
    { description: "x".repeat(8001) },
    { description: "! ".repeat(50) },
  ])("rejects bounded or insufficient content %j", async (body) => {
    expect((await request(body)).status).toBe(422);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
});
