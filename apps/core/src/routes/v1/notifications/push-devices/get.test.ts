import { beforeEach, expect, it, vi } from "vitest";
import { badGateway, serviceUnavailable } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./get";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/ably/push-devices", () => ({ listPushDevices: list }));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
const user: AuthenticationContext = {
  actor: "user",
  userId: "user-1",
  organizationId: null,
  role: "user",
};
function app(context: AuthenticationContext = user) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", context);
    return next();
  });
  mount(app);
  return app;
}
beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue([]);
});
it("uses the authenticated owner, ignores supplied user IDs, and disables caching", async () => {
  list.mockResolvedValue([
    {
      id: "a",
      platform: "browser",
      formFactor: "desktop",
      state: "active",
      deviceSecret: "secret",
    },
  ]);
  const response = await app().request("/push-devices?userId=someone-else");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(list).toHaveBeenCalledExactlyOnceWith("user-1");
  expect((await response.json()).data).toEqual([
    { id: "a", platform: "browser", formFactor: "desktop", state: "active" },
  ]);
});
it("rejects a coworker impersonating the owner", async () => {
  const response = await app({
    actor: "coworker",
    coworkerId: "coworker-1",
    vendorId: "vendor-1",
    context: { userId: "user-1", organizationId: null },
  }).request("/push-devices");
  expect(response.status).toBe(403);
  expect(list).not.toHaveBeenCalled();
});
it.each([
  badGateway("Unable to retrieve push devices"),
  serviceUnavailable("Push device listing is not configured"),
])("preserves failure status $status", async (error) => {
  list.mockRejectedValue(error);
  const response = await app().request("/push-devices");
  expect(response.status).toBe(error.status);
});
it("publishes the device contract in OpenAPI", () => {
  const document = app().getOpenAPIDocument({
    openapi: "3.0.0",
    info: { title: "Test", version: "1" },
  });
  expect(document.paths?.["/push-devices"]?.get?.responses).toHaveProperty(
    "503",
  );
  expect(document.components?.schemas?.PushDevice).toBeDefined();
});

it("rejects Soko Bot access to the owner's devices", async () => {
  const response = await app({
    actor: "sokoBot",
    sokoBotId: "bot-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    organizationId: null,
  }).request("/push-devices");
  expect(response.status).toBe(403);
  expect(list).not.toHaveBeenCalled();
});
