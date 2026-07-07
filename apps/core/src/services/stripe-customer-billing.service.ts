import { MemberRole } from "@sokosumi/database";

import { stripeClient } from "@/clients/stripe.client";
import { notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";
import {
  emptyStripeCustomerBillingDetails,
  type StripeCustomerBillingDetails,
} from "@/schemas/stripe.schema";

async function getBillingDetailsForCustomer(
  stripeCustomerId: string | null,
): Promise<StripeCustomerBillingDetails> {
  if (!stripeCustomerId) {
    return emptyStripeCustomerBillingDetails;
  }

  const details =
    await stripeClient.retrieveCustomerBillingDetails(stripeCustomerId);

  if (!details.stripeCustomerId) {
    return { ...details, stripeCustomerId };
  }

  return details;
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
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    return await getBillingDetailsForCustomer(organization.stripeCustomerId);
  },
};
