import { stripeClient } from "@/clients/stripe.client";
import { notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";
import type { StripeCustomerBillingDetails } from "@/schemas/stripe.schema";

async function getBillingDetailsForCustomer(
  stripeCustomerId: string | null,
): Promise<StripeCustomerBillingDetails> {
  if (!stripeCustomerId) {
    return {
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    };
  }

  return await stripeClient.retrieveCustomerBillingDetails(stripeCustomerId);
}

export const stripeCustomerBillingService = {
  async getUserBillingDetails(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    return await getBillingDetailsForCustomer(user.stripeCustomerId);
  },

  async getOrganizationBillingDetails(organizationId: string, userId: string) {
    const { organization } = await resolveMemberOrganizationById({
      id: organizationId,
      userId,
      tx: prisma,
    });

    return await getBillingDetailsForCustomer(organization.stripeCustomerId);
  },
};
