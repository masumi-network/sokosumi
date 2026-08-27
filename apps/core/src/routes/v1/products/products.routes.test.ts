import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listPricesMock } = vi.hoisted(() => ({
  listPricesMock: vi.fn(),
}));

vi.mock("@/services/invoice-admin.service", () => ({
  InvoiceValidationError: class InvoiceValidationError extends Error {},
  invoiceAdminService: {
    listPrices: listPricesMock,
  },
}));

const { default: mountListCreditPrices } = await import("./credits/get.js");

interface AppOptions {
  actor?: "user" | "coworker";
}

function createApp(options: AppOptions = {}) {
  const { actor = "user" } = options;
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_products_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "member",
      });
    }

    await next();
  });

  app.onError(errorHandler);
  mountListCreditPrices(app);

  return app;
}

describe("products routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPricesMock.mockResolvedValue([
      {
        id: "price_1",
        amountPerCredit: 120,
        currency: "eur",
        nickname: null,
      },
    ]);
  });

  it("lists credit prices for any signed-in user (no admin role required)", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/credits");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      { id: "price_1", amountPerCredit: 120, currency: "eur", nickname: null },
    ]);
  });

  it("rejects coworker auth without delegation", async () => {
    const app = createApp({ actor: "coworker" });

    const response = await app.request("http://localhost/credits");

    expect(response.status).toBe(403);
    expect(listPricesMock).not.toHaveBeenCalled();
  });
});
