import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOrganizationCustomerMock,
  createUserCustomerMock,
  organizationUpdateMock,
  userUpdateMock,
} = vi.hoisted(() => ({
  createOrganizationCustomerMock: vi.fn(),
  createUserCustomerMock: vi.fn(),
  organizationUpdateMock: vi.fn(),
  userUpdateMock: vi.fn(),
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
});
