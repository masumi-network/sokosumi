import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  createInvoiceMock,
  getInvoiceMock,
  listInvoicesMock,
  listPricesMock,
  markInvoicePaidMock,
} = vi.hoisted(() => ({
  createInvoiceMock: vi.fn(),
  getInvoiceMock: vi.fn(),
  listInvoicesMock: vi.fn(),
  listPricesMock: vi.fn(),
  markInvoicePaidMock: vi.fn(),
}));

vi.mock("@/services/invoice-admin.service", () => {
  class InvoiceValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "InvoiceValidationError";
    }
  }

  return {
    InvoiceValidationError,
    invoiceAdminService: {
      createInvoice: createInvoiceMock,
      getInvoice: getInvoiceMock,
      listInvoices: listInvoicesMock,
      listPrices: listPricesMock,
      markInvoicePaid: markInvoicePaidMock,
    },
  };
});

const { InvoiceValidationError } = await import(
  "@/services/invoice-admin.service"
);
const { default: mountListInvoices } = await import("./get.js");
const { default: mountCreateInvoice } = await import("./post.js");
const { default: mountGetInvoice } = await import("./[id]/get.js");
const { default: mountMarkInvoicePaid } = await import("./[id]/pay/post.js");

const SUMMARY = {
  invoiceId: "in_1",
  targetType: "organization",
  targetId: "org_1",
  targetName: "Acme",
  credits: 10,
  ttlDays: null,
  currency: "eur",
  amountDue: 1200,
  status: "open",
  dashboardUrl: "https://dashboard.stripe.com/acct_1/invoices/in_1",
};

interface AppOptions {
  role?: string;
}

function createApp(options: AppOptions = {}) {
  const { role = "admin" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_invoices_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role,
    });

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  const authApp = app as unknown as OpenAPIHonoWithAuth;
  mountListInvoices(authApp);
  mountCreateInvoice(authApp);
  mountMarkInvoicePaid(authApp);
  mountGetInvoice(authApp);

  return app;
}

describe("admin invoices routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInvoicesMock.mockResolvedValue([]);
    createInvoiceMock.mockResolvedValue(SUMMARY);
    getInvoiceMock.mockResolvedValue(SUMMARY);
    markInvoicePaidMock.mockResolvedValue({ ...SUMMARY, status: "paid" });
  });

  it("returns 403 for non-admin users", async () => {
    const app = createApp({ role: "member" });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(listInvoicesMock).not.toHaveBeenCalled();
  });

  it("lists invoices for an admin", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(listInvoicesMock).toHaveBeenCalledWith({
      status: undefined,
      recipient: null,
      limit: undefined,
    });
  });

  it("carries the invoice_invalid kind on validation failures", async () => {
    createInvoiceMock.mockRejectedValue(
      new InvoiceValidationError("Credits must be a positive integer"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_1",
        credits: 1,
        ttlDays: null,
        priceId: null,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.kind).toBe("invoice_invalid");
    expect(body.message).toBe("Credits must be a positive integer");
  });

  it("carries the invoice_not_found kind when the detail lookup misses", async () => {
    getInvoiceMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/in_missing");

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.kind).toBe("invoice_not_found");
  });

  it("carries the invoice_not_found kind when the pay lookup misses", async () => {
    markInvoicePaidMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/in_missing/pay", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.kind).toBe("invoice_not_found");
  });

  it("marks an invoice paid and returns the summary", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/in_1/pay", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("paid");
    expect(markInvoicePaidMock).toHaveBeenCalledWith("in_1");
  });
});
