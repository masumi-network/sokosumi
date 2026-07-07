import { MemberRole } from "@sokosumi/database";
import { getOrganizationMetadata } from "@sokosumi/utils";
import Stripe from "stripe";

import {
  type StripeCustomerBillingAddress,
  stripeClient,
} from "@/clients/stripe.client";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";
import type {
  StripeCustomerBillingDetails,
  StripeCustomerBillingDetailsWrite,
} from "@/schemas/stripe.schema";

function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError;
}

function mapStripeBillingError(error: unknown): never {
  if (isStripeError(error)) {
    if (error.code === "customer_tax_location_invalid") {
      throw unprocessableEntity(
        "The billing address could not be validated for tax calculation. Please verify the address.",
      );
    }

    if (
      error.code === "tax_id_invalid" ||
      error.param === "tax_id" ||
      error.param?.startsWith("tax_id")
    ) {
      throw unprocessableEntity(
        error.message || "The tax ID could not be validated.",
      );
    }

    if (error.type === "StripeInvalidRequestError") {
      throw unprocessableEntity(error.message);
    }
  }

  if (error instanceof Error && error.message.includes("Tax ID collection")) {
    throw unprocessableEntity(error.message);
  }

  throw error;
}

async function ensureUserStripeCustomerId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });

  if (!user) {
    throw notFound("User not found");
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripeClient.createUserCustomer({
    email: user.email,
    name: user.name,
    userId: user.id,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

async function ensureOrganizationStripeCustomerId(
  organizationId: string,
): Promise<string> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      stripeCustomerId: true,
      metadata: true,
    },
  });

  if (!organization) {
    throw notFound("Organization not found");
  }

  if (organization.stripeCustomerId) {
    return organization.stripeCustomerId;
  }

  const customer = await stripeClient.createOrganizationCustomer({
    organizationId: organization.id,
    slug: organization.slug,
    name: organization.name,
    invoiceEmail: getOrganizationMetadata(organization.metadata).invoiceEmail,
  });

  await prisma.organization.update({
    where: { id: organization.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

async function getBillingDetailsForCustomer(
  stripeCustomerId: string | null,
): Promise<StripeCustomerBillingDetails> {
  if (!stripeCustomerId) {
    return {
      stripeCustomerId: null,
      address: null,
      taxIds: [],
    };
  }

  return await stripeClient.retrieveCustomerBillingDetails(stripeCustomerId);
}

async function updateBillingDetailsForCustomer(
  stripeCustomerId: string,
  payload: StripeCustomerBillingDetailsWrite,
): Promise<StripeCustomerBillingDetails> {
  try {
    await stripeClient.updateCustomerBillingAddress(
      stripeCustomerId,
      payload.address as StripeCustomerBillingAddress,
    );

    if (payload.taxId !== undefined) {
      await stripeClient.replaceCustomerTaxIds(
        stripeCustomerId,
        payload.taxId
          ? {
              country: payload.address.country,
              value: payload.taxId.value,
            }
          : null,
      );
    }

    return await stripeClient.retrieveCustomerBillingDetails(stripeCustomerId);
  } catch (error) {
    mapStripeBillingError(error);
  }
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

  async updateUserBillingDetails(
    userId: string,
    payload: StripeCustomerBillingDetailsWrite,
  ) {
    const stripeCustomerId = await ensureUserStripeCustomerId(userId);
    return await updateBillingDetailsForCustomer(stripeCustomerId, payload);
  },

  async getOrganizationBillingDetails(organizationId: string, userId: string) {
    const { organization } = await resolveMemberOrganizationById({
      id: organizationId,
      userId,
      tx: prisma,
    });

    return await getBillingDetailsForCustomer(organization.stripeCustomerId);
  },

  async updateOrganizationBillingDetails(
    organizationId: string,
    userId: string,
    payload: StripeCustomerBillingDetailsWrite,
  ) {
    await resolveMemberOrganizationById({
      id: organizationId,
      userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const stripeCustomerId =
      await ensureOrganizationStripeCustomerId(organizationId);
    return await updateBillingDetailsForCustomer(stripeCustomerId, payload);
  },
};
