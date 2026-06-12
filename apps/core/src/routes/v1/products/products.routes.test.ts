import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";

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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_products_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", { actor: "coworker", coworkerId: "cow_123" });
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
  mountListCreditPrices(app as unknown as OpenAPIHonoWithAuth);

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
