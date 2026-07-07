import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieveCustomerBillingDetailsMock } = vi.hoisted(() => ({
  retrieveCustomerBillingDetailsMock: vi.fn(),
}));

const resolveMemberOrganizationByIdMock = vi.fn();

vi.mock("@/clients/stripe.client", () => ({
  emptyStripeCustomerBillingDetails: {
    stripeCustomerId: null,
    email: null,
    address: null,
    taxIds: [],
  },
  stripeClient: {
    retrieveCustomerBillingDetails: (...args: unknown[]) =>
      retrieveCustomerBillingDetailsMock(...args),
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "@/lib/db/prisma";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

const address = {
  line1: "123 Main St",
  line2: null,
  city: "Berlin",
  state: null,
  postalCode: "10115",
  country: "DE",
};

const billingDetails = {
  stripeCustomerId: "cus_1",
  email: "billing@example.com",
  address,
  taxIds: [],
};

describe("stripeCustomerBillingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveCustomerBillingDetailsMock.mockResolvedValue(billingDetails);
  });

  it("returns empty billing details when user has no stripe customer", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      stripeCustomerId: null,
    } as never);

    await expect(
      stripeCustomerBillingService.getUserBillingDetails("user_1"),
    ).resolves.toEqual({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });
  });

  it("returns empty billing details when stripe retrieval fails", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      stripeCustomerId: "cus_1",
    } as never);
    retrieveCustomerBillingDetailsMock.mockRejectedValue(
      new Error("Stripe unavailable"),
    );

    await expect(
      stripeCustomerBillingService.getUserBillingDetails("user_1"),
    ).resolves.toEqual({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });
  });

  it("returns stripe billing details for a user with a customer", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      stripeCustomerId: "cus_1",
    } as never);

    await expect(
      stripeCustomerBillingService.getUserBillingDetails("user_1"),
    ).resolves.toEqual(billingDetails);

    expect(retrieveCustomerBillingDetailsMock).toHaveBeenCalledWith("cus_1");
  });

  it("returns stripe billing details for an organization member", async () => {
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1", stripeCustomerId: "cus_org_1" },
    });

    await expect(
      stripeCustomerBillingService.getOrganizationBillingDetails(
        "org_1",
        "user_1",
      ),
    ).resolves.toEqual(billingDetails);

    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_1",
        userId: "user_1",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(retrieveCustomerBillingDetailsMock).toHaveBeenCalledWith(
      "cus_org_1",
    );
  });
});
