import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./post";

const mocks = vi.hoisted(() => ({
  network: "Preprod",
  vendor: vi.fn(),
  member: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NETWORK: mocks.network }),
  };
});
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/helpers/coworker", () => ({
  coworkerInclude: {},
  mapCoworker: (value: object) => value,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: object) => Promise<object>) =>
      callback({
        $queryRaw: mocks.lock,
        vendor: { findUnique: mocks.vendor },
        vendorMember: { findFirst: mocks.member },
        coworker: { findUnique: mocks.existing, create: mocks.create },
      }),
  },
}));

const user = {
  actor: "user",
  userId: "participant",
  organizationId: null,
  role: "user",
} as const;
const vendorId = "01960001-0001-7001-8001-000000000001";
function request(actor: AuthenticationContext = user, fields: object = {}) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "self-service-test");
    c.set("isAuthenticated", true);
    c.set("authContext", actor);
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app.request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vendorId,
      name: "Participant demo",
      capabilities: ["tasks"],
      ...fields,
    }),
  });
}

describe("private Coworker self-service creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.network = "Preprod";
    mocks.vendor.mockResolvedValue({ id: vendorId });
    mocks.member.mockResolvedValue({ id: "vendor-admin" });
    mocks.existing.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }) => ({
      id: "coworker",
      ...data,
    }));
  });

  it("allows an owning Vendor admin on Preprod and keeps the Coworker private", async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(mocks.member).toHaveBeenCalledWith({
      where: { vendorId, userId: "participant", role: "admin" },
      select: { id: true },
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      vendorId,
      isWhitelisted: false,
      priority: 0,
    });
  });

  it("rejects a non-admin on Mainnet before database writes", async () => {
    mocks.network = "Mainnet";
    expect((await request()).status).toBe(403);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a non-admin when NETWORK is unset", async () => {
    vi.stubEnv("NETWORK", undefined);
    try {
      expect((await request()).status).toBe(403);
      expect(mocks.lock).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("preserves platform-admin creation on Mainnet", async () => {
    mocks.network = "Mainnet";
    expect(
      (await request({ ...user, role: "admin" }, { priority: 4 })).status,
    ).toBe(201);
    expect(mocks.member).not.toHaveBeenCalled();
  });

  it("rejects foreign Vendor users and developer memberships", async () => {
    mocks.member.mockResolvedValue(null);
    expect((await request()).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects runtime actors", async () => {
    expect(
      (await request({ actor: "coworker", coworkerId: "coworker", vendorId }))
        .status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects participant priority overrides", async () => {
    expect((await request(user, { priority: 0 })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects global whitelist fields", async () => {
    expect((await request(user, { isWhitelisted: true })).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves slug conflicts without creating a second Coworker", async () => {
    mocks.existing.mockResolvedValue({ id: "existing" });
    expect((await request()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
