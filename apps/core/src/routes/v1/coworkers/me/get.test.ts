import { beforeEach, describe, expect, it, vi } from "vitest";

import { coworkerInclude } from "@/helpers/coworker";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { testVendor } from "@/test-fixtures/vendor";
import mountGetCoworkerMe from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { coworkerFindFirstMock } = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
    });
    return await next();
  });

  mountGetCoworkerMe(app);
  return app;
}

describe("GET /coworkers/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns baseURL for the current coworker", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      priority: 10,
      capabilities: ["tasks"],
      slug: "ops-agent",
      name: "Ops Agent",
      baseURL: null,
      vendor: testVendor,
    });

    const app = createApp();
    const response = await app.request("http://localhost/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.priority).toBe(10);
    expect(body.data.capabilities).toEqual(["tasks"]);
    expect(body.data.baseURL).toBeNull();
  });

  it("returns 404 when current coworker is archived or missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/me");
    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
      include: coworkerInclude,
    });
  });
});
