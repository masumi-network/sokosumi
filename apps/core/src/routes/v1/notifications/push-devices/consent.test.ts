import { beforeEach, expect, it, vi } from "vitest";
import { badGateway, notFound } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountDelete from "./delete";
import mountPost from "./post";
import mountPut from "./put";

const { begin, subscribe, revoke } = vi.hoisted(() => ({
  begin: vi.fn(),
  subscribe: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/ably/push-device-consent", () => ({
  beginPushActivation: begin,
  subscribePushDevice: subscribe,
  revokePushDevice: revoke,
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
const consentId = "01998af0-b49e-7000-8000-000000000001";
const activation = { deviceId: "device-1", readerInitiated: false };
const subscription = { consentId, revision: 2 };
function app(context: AuthenticationContext = user) {
  const result = new OpenAPIHonoWithAuth();
  result.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", context);
    return next();
  });
  mountPost(result);
  mountPut(result);
  mountDelete(result);
  return result;
}
function options(method: string, body?: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  begin.mockResolvedValue({
    id: consentId,
    revision: 2,
    revoked: false,
    replaceDevice: false,
  });
  subscribe.mockResolvedValue(true);
  revoke.mockResolvedValue(undefined);
});
it("begins recovery for the authenticated user with no cache", async () => {
  const response = await app().request(
    "/push-devices/activations",
    options("POST", activation),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    data: { id: consentId, revision: 2, revoked: false, replaceDevice: false },
  });
  expect(begin).toHaveBeenCalledExactlyOnceWith("user-1", activation);
});
it("binds only against the supplied consent revision", async () => {
  const response = await app().request(
    "/push-devices/device-1/subscription",
    options("PUT", subscription),
  );
  expect(response.status).toBe(200);
  expect(subscribe).toHaveBeenCalledExactlyOnceWith(
    "user-1",
    "device-1",
    subscription,
  );
  expect(await response.json()).toMatchObject({ data: { subscribed: true } });
});
it("reports a revoked activation without claiming subscription success", async () => {
  subscribe.mockResolvedValue(false);
  const response = await app().request(
    "/push-devices/device-1/subscription",
    options("PUT", subscription),
  );
  expect(await response.json()).toMatchObject({ data: { subscribed: false } });
});
it("revokes the authenticated user's device", async () => {
  const response = await app().request(
    "/push-devices/device-1",
    options("DELETE"),
  );
  expect(response.status).toBe(200);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("user-1", "device-1");
  expect(await response.json()).toMatchObject({ data: { success: true } });
});
it.each([
  ["POST", "/push-devices/activations", { ...activation, userId: "other" }],
  [
    "POST",
    "/push-devices/activations",
    { ...activation, consentId: "invalid" },
  ],
  ["POST", "/push-devices/activations", { deviceId: "device-1" }],
  ["POST", "/push-devices/activations", { ...activation, deviceId: "" }],
  [
    "PUT",
    "/push-devices/device-1/subscription",
    { ...subscription, revision: -1 },
  ],
  [
    "PUT",
    "/push-devices/device-1/subscription",
    { ...subscription, revision: 2147483648 },
  ],
  [
    "PUT",
    "/push-devices/device-1/subscription",
    { ...subscription, channel: "foreign" },
  ],
  ["DELETE", `/push-devices/${"a".repeat(257)}`, undefined],
])("rejects invalid %s %s", async (method, path, body) => {
  expect((await app().request(path, options(method, body))).status).toBe(422);
  expect(begin).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
});
it.each([
  ["POST", "/push-devices/activations", activation],
  ["PUT", "/push-devices/device-1/subscription", subscription],
  ["DELETE", "/push-devices/device-1", undefined],
])("rejects coworker %s access", async (method, path, body) => {
  const result = app({
    actor: "coworker",
    coworkerId: "c",
    vendorId: "v",
    context: { userId: "user-1", organizationId: null },
  });
  expect((await result.request(path, options(method, body))).status).toBe(403);
  expect(begin).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
});
it.each([
  notFound("Push device not found"),
  badGateway("Unable to manage push device"),
])("preserves a failed revoke's status $status", async (error) => {
  revoke.mockRejectedValue(error);
  expect(
    (await app().request("/push-devices/device-1", options("DELETE"))).status,
  ).toBe(error.status);
});
