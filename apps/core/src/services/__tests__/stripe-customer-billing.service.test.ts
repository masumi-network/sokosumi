import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOrganizationCustomerMock,
  createUserCustomerMock,
  replaceCustomerTaxIdsMock,
  retrieveCustomerBillingDetailsMock,
  updateCustomerBillingAddressMock,
} = vi.hoisted(() => ({
  createOrganizationCustomerMock: vi.fn(),
  createUserCustomerMock: vi.fn(),
  replaceCustomerTaxIdsMock: vi.fn(),
  retrieveCustomerBillingDetailsMock: vi.fn(),
  updateCustomerBillingAddressMock: vi.fn(),
}));

const resolveMemberOrganizationByIdMock = vi.fn();

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
    replaceCustomerTaxIds: (...args: unknown[]) =>
      replaceCustomerTaxIdsMock(...args),
    retrieveCustomerBillingDetails: (...args: unknown[]) =>
      retrieveCustomerBillingDetailsMock(...args),
    updateCustomerBillingAddress: (...args: unknown[]) =>
      updateCustomerBillingAddressMock(...args),
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
      update: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
  address,
  taxIds: [],
};

describe("stripeCustomerBillingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveCustomerBillingDetailsMock.mockResolvedValue(billingDetails);
    updateCustomerBillingAddressMock.mockResolvedValue({ id: "cus_1" });
    replaceCustomerTaxIdsMock.mockResolvedValue(undefined);
  });

  it("returns empty billing details when user has no stripe customer", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      stripeCustomerId: null,
    } as never);

    await expect(
      stripeCustomerBillingService.getUserBillingDetails("user_1"),
    ).resolves.toEqual({
      stripeCustomerId: null,
      address: null,
      taxIds: [],
    });
  });

  it("provisions a stripe customer before updating user billing details", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
      stripeCustomerId: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    createUserCustomerMock.mockResolvedValue({ id: "cus_new" });

    await stripeCustomerBillingService.updateUserBillingDetails("user_1", {
      address,
      taxId: { value: "DE123456789" },
    });

    expect(createUserCustomerMock).toHaveBeenCalledWith({
      email: "user@example.com",
      name: "User",
      userId: "user_1",
    });
    expect(updateCustomerBillingAddressMock).toHaveBeenCalledWith(
      "cus_new",
      address,
    );
    expect(replaceCustomerTaxIdsMock).toHaveBeenCalledWith("cus_new", {
      country: "DE",
      value: "DE123456789",
    });
  });

  it("requires owner or admin to update organization billing details", async () => {
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1", stripeCustomerId: "cus_org_1" },
    });
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: "org_1",
      name: "Org",
      slug: "org",
      stripeCustomerId: "cus_org_1",
      metadata: null,
    } as never);

    await stripeCustomerBillingService.updateOrganizationBillingDetails(
      "org_1",
      "user_1",
      { address },
    );

    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_1",
        userId: "user_1",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });
});
