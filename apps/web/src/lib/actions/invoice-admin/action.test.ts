import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const markInvoicePaidMock = vi.fn();
const deleteInvoiceMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/invoice-admin.service", () => {
  class InvoiceValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "InvoiceValidationError";
    }
  }

  return {
    InvoiceValidationError,
    invoiceAdminService: {
      markInvoicePaid: (...args: unknown[]) => markInvoicePaidMock(...args),
      deleteInvoice: (...args: unknown[]) => deleteInvoiceMock(...args),
    },
  };
});

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { InvoiceValidationError } from "@/lib/services/invoice-admin.service";

import { deleteAdminInvoiceAction, markAdminInvoicePaidAction } from "./action";

const SUMMARY = {
  invoiceId: "in_1",
  targetType: "organization" as const,
  targetId: "org_1",
  targetName: "Acme",
  credits: 10,
  ttlDays: null,
  currency: "usd",
  amountDue: 1000,
  status: "paid" as const,
  dashboardUrl: "https://dashboard.stripe.com/acct_1/invoices/in_1",
};

const adminSession = {
  user: {
    id: "admin-1",
    role: "admin",
  },
} as never;

describe("markAdminInvoicePaidAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the paid summary and revalidates on success", async () => {
    markInvoicePaidMock.mockResolvedValue(SUMMARY);

    const result = await markAdminInvoicePaidAction({
      session: adminSession,
      invoiceId: "in_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }
    expect(result.value).toEqual(SUMMARY);
    expect(markInvoicePaidMock).toHaveBeenCalledWith("in_1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/invoices");
  });

  it("maps a core invoice_not_found error to NOT_FOUND", async () => {
    markInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("Admin invoice not found", {
        status: 404,
        kind: "invoice_not_found",
      }),
    );

    const result = await markAdminInvoicePaidAction({
      session: adminSession,
      invoiceId: "in_missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.NOT_FOUND);
    expect(result.error.message).toBe("Admin invoice not found");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("maps a bare core 404 without an error kind to NOT_FOUND", async () => {
    markInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    const result = await markAdminInvoicePaidAction({
      session: adminSession,
      invoiceId: "in_missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.NOT_FOUND);
  });

  it("maps an InvoiceValidationError to BAD_INPUT", async () => {
    markInvoicePaidMock.mockRejectedValue(
      new InvoiceValidationError("Invoice is not an admin invoice"),
    );

    const result = await markAdminInvoicePaidAction({
      session: adminSession,
      invoiceId: "in_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(result.error.message).toBe("Invoice is not an admin invoice");
  });

  it("maps other core errors to INTERNAL_SERVER_ERROR", async () => {
    markInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    const result = await markAdminInvoicePaidAction({
      session: adminSession,
      invoiceId: "in_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("returns UNAUTHORIZED for non-admin sessions", async () => {
    const memberSession = {
      user: {
        id: "user-1",
        role: "user",
      },
    } as never;

    const result = await markAdminInvoicePaidAction({
      session: memberSession,
      invoiceId: "in_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(markInvoicePaidMock).not.toHaveBeenCalled();
  });
});

describe("deleteAdminInvoiceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteInvoiceMock.mockResolvedValue(undefined);
  });

  it("deletes the invoice and revalidates on success", async () => {
    const result = await deleteAdminInvoiceAction({
      session: adminSession,
      invoiceId: "in_1",
    });

    expect(result.ok).toBe(true);
    expect(deleteInvoiceMock).toHaveBeenCalledWith("in_1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/invoices");
  });

  it("maps a core invoice_not_found error to NOT_FOUND", async () => {
    deleteInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("Admin invoice not found", {
        status: 404,
        kind: "invoice_not_found",
      }),
    );

    const result = await deleteAdminInvoiceAction({
      session: adminSession,
      invoiceId: "in_missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.NOT_FOUND);
  });
});
