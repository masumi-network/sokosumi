import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listCreditPricesMock = vi.fn();
const listAdminInvoicesMock = vi.fn();
const createAdminInvoiceMock = vi.fn();
const getAdminInvoiceMock = vi.fn();
const markAdminInvoicePaidMock = vi.fn();
const deleteAdminInvoiceMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    listCreditPrices: (...args: unknown[]) => listCreditPricesMock(...args),
    listAdminInvoices: (...args: unknown[]) => listAdminInvoicesMock(...args),
    createAdminInvoice: (...args: unknown[]) => createAdminInvoiceMock(...args),
    getAdminInvoice: (...args: unknown[]) => getAdminInvoiceMock(...args),
    markAdminInvoicePaid: (...args: unknown[]) =>
      markAdminInvoicePaidMock(...args),
    deleteAdminInvoice: (...args: unknown[]) => deleteAdminInvoiceMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.shared";

import {
  InvoiceValidationError,
  invoiceAdminService,
} from "../invoice-admin.service";

const SUMMARY = {
  invoiceId: "in_1",
  targetType: "organization" as const,
  targetId: "org_1",
  targetName: "Acme",
  credits: 10,
  ttlDays: null,
  currency: "usd",
  amountDue: 1000,
  status: "open" as const,
  dashboardUrl: "https://dashboard.stripe.com/acct_1/invoices/in_1",
};

describe("invoiceAdminService (core client wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists credit prices through the core client", async () => {
    const prices = [
      { id: "price_1", amountPerCredit: 120, currency: "eur", nickname: null },
    ];
    listCreditPricesMock.mockResolvedValue({ data: prices });

    await expect(invoiceAdminService.listPrices()).resolves.toEqual(prices);
  });

  it("maps the recipient filter onto query params when listing", async () => {
    listAdminInvoicesMock.mockResolvedValue({ data: [] });

    await invoiceAdminService.listInvoices({
      status: "paid",
      recipient: { targetType: "user", targetId: "user_1" },
      limit: 10,
    });

    expect(listAdminInvoicesMock).toHaveBeenCalledWith({
      status: "paid",
      recipientType: "user",
      recipientId: "user_1",
      limit: 10,
    });
  });

  it("omits recipient params when no recipient filter is given", async () => {
    listAdminInvoicesMock.mockResolvedValue({ data: [] });

    await invoiceAdminService.listInvoices();

    expect(listAdminInvoicesMock).toHaveBeenCalledWith({
      status: undefined,
      limit: undefined,
    });
  });

  it("flattens the create params into the request body", async () => {
    createAdminInvoiceMock.mockResolvedValue({ data: SUMMARY });

    const summary = await invoiceAdminService.createInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: 30,
      priceId: "price_1",
    });

    expect(createAdminInvoiceMock).toHaveBeenCalledWith({
      targetType: "organization",
      targetId: "org_1",
      credits: 10,
      ttlDays: 30,
      priceId: "price_1",
    });
    expect(summary).toEqual(SUMMARY);
  });

  it("maps a core invoice_invalid error to InvoiceValidationError", async () => {
    createAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("Credits must be a positive integer", {
        status: 400,
        kind: "invoice_invalid",
      }),
    );

    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: -1,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow(InvoiceValidationError);
    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: -1,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow("Credits must be a positive integer");
  });

  it("rethrows non-validation core errors from create", async () => {
    createAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: 10,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow(CoreApiRequestError);
  });

  it("returns null when the invoice detail misses with invoice_not_found", async () => {
    getAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("Admin invoice not found", {
        status: 404,
        kind: "invoice_not_found",
      }),
    );

    await expect(
      invoiceAdminService.getInvoice("in_missing"),
    ).resolves.toBeNull();
  });

  it("returns null on a bare 404 without an error kind", async () => {
    getAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    await expect(
      invoiceAdminService.getInvoice("in_missing"),
    ).resolves.toBeNull();
  });

  it("rethrows non-404 errors from the detail fetch", async () => {
    getAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    await expect(invoiceAdminService.getInvoice("in_1")).rejects.toThrow(
      CoreApiRequestError,
    );
  });

  it("returns the detail summary on success", async () => {
    getAdminInvoiceMock.mockResolvedValue({ data: SUMMARY });

    await expect(invoiceAdminService.getInvoice("in_1")).resolves.toEqual(
      SUMMARY,
    );
    expect(getAdminInvoiceMock).toHaveBeenCalledWith("in_1");
  });

  it("maps mark-paid validation errors to InvoiceValidationError", async () => {
    markAdminInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("Invoice is not an admin invoice", {
        status: 400,
        kind: "invoice_invalid",
      }),
    );

    await expect(invoiceAdminService.markInvoicePaid("in_1")).rejects.toThrow(
      "Invoice is not an admin invoice",
    );
  });

  it("rethrows core invoice_not_found errors from mark-paid with kind and status intact", async () => {
    markAdminInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("Admin invoice not found", {
        status: 404,
        kind: "invoice_not_found",
      }),
    );

    await expect(
      invoiceAdminService.markInvoicePaid("in_missing"),
    ).rejects.toMatchObject({
      name: "CoreApiRequestError",
      kind: "invoice_not_found",
      status: 404,
    });
  });

  it("rethrows bare core 404s from mark-paid", async () => {
    markAdminInvoicePaidMock.mockRejectedValue(
      new CoreApiRequestError("Not found", { status: 404 }),
    );

    await expect(
      invoiceAdminService.markInvoicePaid("in_missing"),
    ).rejects.toMatchObject({ name: "CoreApiRequestError", status: 404 });
  });

  it("returns the paid summary from mark-paid", async () => {
    markAdminInvoicePaidMock.mockResolvedValue({
      data: { ...SUMMARY, status: "paid" },
    });

    await expect(
      invoiceAdminService.markInvoicePaid("in_1"),
    ).resolves.toMatchObject({ status: "paid" });
    expect(markAdminInvoicePaidMock).toHaveBeenCalledWith("in_1");
  });

  it("calls delete through the core client", async () => {
    deleteAdminInvoiceMock.mockResolvedValue({ data: {} });

    await invoiceAdminService.deleteInvoice("in_1");

    expect(deleteAdminInvoiceMock).toHaveBeenCalledWith("in_1");
  });

  it("maps delete validation errors to InvoiceValidationError", async () => {
    deleteAdminInvoiceMock.mockRejectedValue(
      new CoreApiRequestError("Only draft or open invoices can be deleted", {
        status: 400,
        kind: "invoice_invalid",
      }),
    );

    await expect(invoiceAdminService.deleteInvoice("in_1")).rejects.toThrow(
      "Only draft or open invoices can be deleted",
    );
  });
});
