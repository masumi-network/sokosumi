import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { UserAuthenticationContext } from "@/middleware/auth";

import mountGet from "./get";
import mountPost from "./post";
import mountRevoke from "./revoke/post";

const service = vi.hoisted(() => ({
  connect: vi.fn(),
  get: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/services/mps-seller.service", () => ({
  connectMpsSeller: service.connect,
  getMpsSeller: service.get,
  revokeMpsSeller: service.revoke,
}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const auth: UserAuthenticationContext = {
  actor: "user",
  userId: "vendor-admin",
  organizationId: null,
  role: "user",
};
const input = {
  apiUrl: "https://seller.example.com",
  apiKey: "seller-private-key",
  agentIdentifier: "ab".repeat(35),
  walletId: "wallet-1",
  paymentSourceId: "source-1",
};

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "seller-route-test");
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    await next();
  });
  app.onError(errorHandler);
  mountGet(app);
  mountPost(app);
  mountRevoke(app);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  service.connect.mockResolvedValue({
    id: "binding-1",
    paymentsEnabled: false,
  });
  service.get.mockResolvedValue(null);
  service.revoke.mockResolvedValue({ id: "binding-1", paymentsEnabled: false });
});

describe("MPS seller routes", () => {
  it("passes validated setup and user credentials to the service", async () => {
    const response = await createApp().request("/coworker-1/mps-seller", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    expect(service.connect).toHaveBeenCalledWith(auth, "coworker-1", input);
    expect(await response.text()).not.toContain(input.apiKey);
  });

  it.each([
    "http://seller.example.com",
    "https://name:seller-private-key@seller.example.com",
    "https://seller.example.com?apiKey=seller-private-key",
    "https://seller.example.com#seller-private-key",
  ])(
    "rejects an unsafe endpoint %s before the service runs",
    async (apiUrl) => {
      const response = await createApp().request("/coworker-1/mps-seller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, apiUrl }),
      });
      expect(response.status).toBe(422);
      expect(await response.text()).not.toContain(input.apiKey);
      expect(service.connect).not.toHaveBeenCalled();
    },
  );

  it("rejects an API key with whitespace without reflecting it", async () => {
    const response = await createApp().request("/coworker-1/mps-seller", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, apiKey: `${input.apiKey}\n` }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(input.apiKey);
    expect(service.connect).not.toHaveBeenCalled();
  });

  it("rejects caller-selected network and payout fields", async () => {
    const response = await createApp().request("/coworker-1/mps-seller", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        network: "Mainnet",
        sellerVkey: "replacement",
      }),
    });
    expect(response.status).toBe(422);
    expect(service.connect).not.toHaveBeenCalled();
  });

  it("reads the active seller through the service", async () => {
    const response = await createApp().request("/coworker-1/mps-seller");
    expect(response.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(auth, "coworker-1");
  });

  it("requires a binding identity for revocation", async () => {
    const response = await createApp().request(
      "/coworker-1/mps-seller/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindingId: "binding-1" }),
      },
    );
    expect(response.status).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith(
      auth,
      "coworker-1",
      "binding-1",
    );
  });
});
