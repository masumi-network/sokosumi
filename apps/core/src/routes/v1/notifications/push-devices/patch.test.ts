import { beforeEach, expect, it, vi } from "vitest";
import { badGateway, serviceUnavailable } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./patch";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/ably/push-device-browser", () => ({
  updatePushDeviceBrowser: update,
}));
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
const details = { browser: "Chrome", operatingSystem: "macOS" };
function options(body: unknown = details) {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  update.mockResolvedValue(undefined);
});
it("updates only the authenticated owner's device", async () => {
  const response = await app().request(
    "/push-devices/device-1/browser",
    options(),
  );
  expect(response.status).toBe(200);
  expect(update).toHaveBeenCalledExactlyOnceWith("user-1", "device-1", details);
  expect(await response.json()).toMatchObject({ data: { success: true } });
});
it.each([
  {},
  { browser: "Chrome" },
  { operatingSystem: "macOS" },
  { browser: "Chrome", registeredAt: "2026-09-27T12:00:00.000Z" },
  { registeredAt: "not-a-date" },
  { registeredAt: "2026-02-30T12:00:00.000Z" },
  { registeredAt: null },
  { browser: "arbitrary", operatingSystem: "macOS" },
  { ...details, userId: "other" },
  { ...details, metadata: {} },
])("rejects untrusted fields: %j", async (body) => {
  const response = await app().request(
    "/push-devices/device-1/browser",
    options(body),
  );
  expect(response.status).toBe(422);
  expect(update).not.toHaveBeenCalled();
});
it("rejects coworker access", async () => {
  const response = await app({
    actor: "coworker",
    coworkerId: "c",
    vendorId: "v",
    context: { userId: "user-1", organizationId: null },
  }).request("/push-devices/device-1/browser", options());
  expect(response.status).toBe(403);
  expect(update).not.toHaveBeenCalled();
});
it.each([
  badGateway("Unable to update push device"),
  serviceUnavailable("Unavailable"),
])("preserves failure status $status", async (error) => {
  update.mockRejectedValue(error);
  expect(
    (await app().request("/push-devices/device-1/browser", options())).status,
  ).toBe(error.status);
});

it.each([
  { registeredAt: "2026-09-27T12:00:00.000Z" },
  { ...details, registeredAt: "2026-09-27T12:00:00.000Z" },
])(
  "accepts registration dates with or without browser names: %j",
  async (body) => {
    const response = await app().request(
      "/push-devices/device-1/browser",
      options(body),
    );
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledExactlyOnceWith("user-1", "device-1", body);
  },
);
