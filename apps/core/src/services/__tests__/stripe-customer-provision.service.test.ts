import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  createOrganizationCustomerMock,
  createUserCustomerMock,
  organizationUpdateMock,
  userUpdateMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createOrganizationCustomerMock: vi.fn(),
  createUserCustomerMock: vi.fn(),
  organizationUpdateMock: vi.fn(),
  userUpdateMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      update: organizationUpdateMock,
    },
    user: {
      update: userUpdateMock,
    },
  },
}));

import {
  provisionOrganizationStripeCustomer,
  provisionUserStripeCustomer,
} from "@/services/stripe-customer-provision.service";

describe("stripeCustomerProvisionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUserCustomerMock.mockResolvedValue({ id: "cus_user" });
    createOrganizationCustomerMock.mockResolvedValue({ id: "cus_org" });
    userUpdateMock.mockResolvedValue(undefined);
    organizationUpdateMock.mockResolvedValue(undefined);
  });

  it("creates and persists a user stripe customer id", async () => {
    await expect(
      provisionUserStripeCustomer({
        id: "user_1",
        name: "Jane",
        email: "jane@example.com",
      }),
    ).resolves.toBe("cus_user");

    expect(createUserCustomerMock).toHaveBeenCalledWith(
      {
        email: "jane@example.com",
        name: "Jane",
        userId: "user_1",
      },
      undefined,
    );
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_user" },
    });
  });

  it("creates and persists an organization stripe customer id", async () => {
    await expect(
      provisionOrganizationStripeCustomer({
        id: "org_1",
        name: "Acme",
        slug: "acme",
      }),
    ).resolves.toBe("cus_org");

    expect(createOrganizationCustomerMock).toHaveBeenCalledWith(
      {
        name: "Acme",
        organizationId: "org_1",
        slug: "acme",
      },
      undefined,
    );
    expect(organizationUpdateMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { stripeCustomerId: "cus_org" },
    });
  });

  it("captures and rethrows when persisting the user customer id fails", async () => {
    const dbError = new Error("db down");
    userUpdateMock.mockRejectedValue(dbError);

    await expect(
      provisionUserStripeCustomer({
        id: "user_1",
        name: "Jane",
        email: "jane@example.com",
      }),
    ).rejects.toBe(dbError);

    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, {
      tags: { context: "stripe_customer_provision", ownerType: "user" },
      extra: { userId: "user_1", stripeCustomerId: "cus_user" },
    });
  });

  it("captures and rethrows when persisting the organization customer id fails", async () => {
    const dbError = new Error("db down");
    organizationUpdateMock.mockRejectedValue(dbError);

    await expect(
      provisionOrganizationStripeCustomer({
        id: "org_1",
        name: "Acme",
        slug: "acme",
      }),
    ).rejects.toBe(dbError);

    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, {
      tags: {
        context: "stripe_customer_provision",
        ownerType: "organization",
      },
      extra: { organizationId: "org_1", stripeCustomerId: "cus_org" },
    });
  });
});
