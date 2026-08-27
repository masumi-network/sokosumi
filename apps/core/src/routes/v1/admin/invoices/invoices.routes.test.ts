import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  createInvoiceMock,
  deleteInvoiceMock,
  getInvoiceMock,
  listInvoicesMock,
  listPricesMock,
  markInvoicePaidMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  createInvoiceMock: vi.fn(),
  deleteInvoiceMock: vi.fn(),
  getInvoiceMock: vi.fn(),
  listInvoicesMock: vi.fn(),
  listPricesMock: vi.fn(),
  markInvoicePaidMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

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
      deleteInvoice: deleteInvoiceMock,
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
const { default: mountDeleteInvoice } = await import("./[id]/delete.js");
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
  authContextState.current = {
    actor: "user",
    userId: "user_admin",
    organizationId: null,
    role,
  };

  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountListInvoices(app);
  mountCreateInvoice(app);
  mountMarkInvoicePaid(app);
  mountDeleteInvoice(app);
  mountGetInvoice(app);

  return app;
}

describe("admin invoices routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInvoicesMock.mockResolvedValue([]);
    createInvoiceMock.mockResolvedValue(SUMMARY);
    getInvoiceMock.mockResolvedValue(SUMMARY);
    markInvoicePaidMock.mockResolvedValue({ ...SUMMARY, status: "paid" });
    deleteInvoiceMock.mockResolvedValue(undefined);
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

  it("deletes an invoice and returns 204", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/in_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(deleteInvoiceMock).toHaveBeenCalledWith("in_1");
  });

  it("carries the invoice_not_found kind when the delete lookup misses", async () => {
    deleteInvoiceMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/in_missing", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.kind).toBe("invoice_not_found");
  });
});
