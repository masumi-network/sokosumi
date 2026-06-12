import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  getOrganizationWithRelationsByIdMock,
  handleCustomerCreatedEventMock,
  handleInvoicePaidEventMock,
  updateOrganizationInvoiceEmailMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  getOrganizationWithRelationsByIdMock: vi.fn(),
  handleCustomerCreatedEventMock: vi.fn(),
  handleInvoicePaidEventMock: vi.fn(),
  updateOrganizationInvoiceEmailMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationWithRelationsById: getOrganizationWithRelationsByIdMock,
    updateOrganizationInvoiceEmail: updateOrganizationInvoiceEmailMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/services/stripe-invoice-credit.service", () => ({
  handleInvoicePaidEvent: handleInvoicePaidEventMock,
}));

vi.mock("@/services/stripe-customer-created.service", () => ({
  handleCustomerCreatedEvent: handleCustomerCreatedEventMock,
}));

async function getStripeWebhookService() {
  const module = await import("./stripe-webhook.service");
  return module.stripeWebhookService;
}

function createCustomerUpdatedEvent(
  customer: Partial<Stripe.Customer>,
): Stripe.Event {
  return {
    id: "evt_123",
    type: "customer.updated",
    data: {
      object: {
        id: "cus_123",
        email: "new@example.com",
        metadata: {},
        ...customer,
      },
    },
  } as Stripe.Event;
}

function createOrganizationCustomer(
  overrides: Partial<Stripe.Customer> = {},
): Partial<Stripe.Customer> {
  return {
    metadata: {
      customerType: "organization",
      organizationId: "org_123",
    },
    ...overrides,
  };
}

function createCustomerCreatedEvent(
  customer: Partial<Stripe.Customer> = {},
): Stripe.Event {
  return {
    id: "evt_created_123",
    type: "customer.created",
    data: {
      object: {
        id: "cus_new_123",
        email: "new@example.com",
        metadata: { customerType: "user", userId: "user_123" },
        ...customer,
      },
    },
  } as Stripe.Event;
}

function createInvoicePaidEvent(): Stripe.Event {
  return {
    id: "evt_inv_123",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_123",
        customer: "cus_123",
      },
    },
  } as Stripe.Event;
}

describe("stripeWebhookService.handleEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_123",
      metadata: JSON.stringify({ invoiceEmail: "old@example.com" }),
    });
    updateOrganizationInvoiceEmailMock.mockResolvedValue({
      id: "org_123",
      metadata: JSON.stringify({ invoiceEmail: "new@example.com" }),
    });
    handleInvoicePaidEventMock.mockResolvedValue(undefined);
    handleCustomerCreatedEventMock.mockResolvedValue(undefined);
  });

  it("dispatches customer.created events to the customer-created handler", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(createCustomerCreatedEvent());

    expect(handleCustomerCreatedEventMock).toHaveBeenCalledTimes(1);
    expect(handleCustomerCreatedEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cus_new_123" }),
    );
  });

  it("reports to Sentry and rethrows when the customer.created handler fails", async () => {
    const failure = new Error("db down");
    handleCustomerCreatedEventMock.mockRejectedValue(failure);
    const service = await getStripeWebhookService();

    await expect(
      service.handleEvent(createCustomerCreatedEvent()),
    ).rejects.toThrow("db down");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "customer.created",
          customerId: "cus_new_123",
        }),
        extra: expect.objectContaining({ eventId: "evt_created_123" }),
      }),
    );
  });

  it("dispatches invoice.paid events to the invoice credit handler", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(createInvoicePaidEvent());

    expect(handleInvoicePaidEventMock).toHaveBeenCalledTimes(1);
    expect(handleInvoicePaidEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "in_123" }),
    );
  });

  it("reports to Sentry and rethrows when the invoice.paid handler fails", async () => {
    const failure = new Error("unknown customer");
    handleInvoicePaidEventMock.mockRejectedValue(failure);
    const service = await getStripeWebhookService();

    await expect(service.handleEvent(createInvoicePaidEvent())).rejects.toThrow(
      "unknown customer",
    );

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "invoice.paid",
          invoiceId: "in_123",
        }),
        extra: expect.objectContaining({
          eventId: "evt_inv_123",
          customer: "cus_123",
        }),
      }),
    );
  });

  it("updates the organization invoice email when the customer email changed", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent(createOrganizationCustomer()),
    );

    expect(getOrganizationWithRelationsByIdMock).toHaveBeenCalledWith(
      "org_123",
      expect.anything(),
    );
    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith(
      "org_123",
      "new@example.com",
      expect.anything(),
    );
  });

  it("clears the organization invoice email when the customer email is null", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent(createOrganizationCustomer({ email: null })),
    );

    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith(
      "org_123",
      null,
      expect.anything(),
    );
  });

  it("skips the write when the invoice email is unchanged", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_123",
      metadata: JSON.stringify({ invoiceEmail: "new@example.com" }),
    });
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent(createOrganizationCustomer()),
    );

    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing when the organization no longer exists", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue(null);
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent(createOrganizationCustomer()),
    );

    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("ignores non-organization customers", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent({
        metadata: { customerType: "user", userId: "user_123" },
      }),
    );

    expect(getOrganizationWithRelationsByIdMock).not.toHaveBeenCalled();
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("ignores organization customers without an organizationId", async () => {
    const service = await getStripeWebhookService();

    await service.handleEvent(
      createCustomerUpdatedEvent({
        metadata: { customerType: "organization" },
      }),
    );

    expect(getOrganizationWithRelationsByIdMock).not.toHaveBeenCalled();
  });

  it("reports to Sentry and rethrows when the handler fails", async () => {
    const failure = new Error("db down");
    getOrganizationWithRelationsByIdMock.mockRejectedValue(failure);
    const service = await getStripeWebhookService();

    await expect(
      service.handleEvent(
        createCustomerUpdatedEvent(createOrganizationCustomer()),
      ),
    ).rejects.toThrow("db down");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "customer.updated",
          customerId: "cus_123",
        }),
        extra: expect.objectContaining({ eventId: "evt_123" }),
      }),
    );
  });

  it("ignores unhandled event types", async () => {
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      const service = await getStripeWebhookService();

      await service.handleEvent({
        id: "evt_456",
        type: "charge.succeeded",
        data: { object: {} },
      } as Stripe.Event);

      expect(getOrganizationWithRelationsByIdMock).not.toHaveBeenCalled();
      expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[webhooks/stripe] Unhandled Stripe event type: charge.succeeded",
      );
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });
});
