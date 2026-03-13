import { beforeEach, describe, expect, it, vi } from "vitest";

const { stripeConstructorMock, stripeCustomersCreateMock } = vi.hoisted(() => ({
  stripeConstructorMock: vi.fn(),
  stripeCustomersCreateMock: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    customers = {
      create: (...args: unknown[]) => stripeCustomersCreateMock(...args),
    };

    constructor(secretKey: string, options?: unknown) {
      stripeConstructorMock(secretKey, options);
    }
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    STRIPE_SECRET_KEY: "sk_test_core",
  }),
}));

describe("stripeClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stripeCustomersCreateMock.mockResolvedValue({ id: "cus_123" });
  });

  it("creates a Stripe client with the configured secret key", async () => {
    await import("./stripe.client");

    expect(stripeConstructorMock).toHaveBeenCalledWith("sk_test_core", {
      maxNetworkRetries: 0,
    });
  });

  it("creates a user customer with user metadata and idempotency", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createUserCustomer({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });

    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      {
        email: "andreas@example.com",
        metadata: {
          customerType: "user",
          userId: "user_123",
        },
        name: "Andreas",
      },
      {
        idempotencyKey: "user-user_123",
        maxNetworkRetries: 0,
      },
    );
  });

  it("creates an organization customer with optional request options", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createOrganizationCustomer(
      {
        invoiceEmail: "billing@example.com",
        name: "Sokosumi Org",
        organizationId: "org_123",
        slug: "sokosumi-org",
      },
      {
        timeout: 2500,
      },
    );

    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      {
        email: "billing@example.com",
        metadata: {
          customerType: "organization",
          organizationId: "org_123",
          organizationSlug: "sokosumi-org",
        },
        name: "Sokosumi Org",
      },
      {
        idempotencyKey: "organization-org_123",
        maxNetworkRetries: 0,
        timeout: 2500,
      },
    );
  });
});
