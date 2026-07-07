import * as Sentry from "@sentry/node";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

/**
 * Creates a Stripe customer for a user and persists the id immediately
 * (write-through) rather than waiting for the customer.created webhook.
 */
export async function provisionUserStripeCustomer(
  user: { id: string; name: string; email: string },
  requestOptions?: Stripe.RequestOptions,
): Promise<string> {
  const customer = await stripeClient.createUserCustomer(
    {
      email: user.email,
      name: user.name,
      userId: user.id,
    },
    requestOptions,
  );

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });
  } catch (error) {
    // The Stripe customer exists but its id was not persisted, leaving an
    // orphan until the sync job or customer.created webhook reconciles it.
    // Capture it so the orphan is observable for reconciliation, then rethrow.
    Sentry.captureException(error, {
      tags: { context: "stripe_customer_provision", ownerType: "user" },
      extra: { userId: user.id, stripeCustomerId: customer.id },
    });
    throw error;
  }

  return customer.id;
}

/**
 * Creates a Stripe customer for an organization and persists the id
 * immediately (write-through) rather than waiting for the customer.created
 * webhook.
 */
export async function provisionOrganizationStripeCustomer(
  organization: { id: string; name: string; slug: string },
  requestOptions?: Stripe.RequestOptions,
): Promise<string> {
  const customer = await stripeClient.createOrganizationCustomer(
    {
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
    },
    requestOptions,
  );

  try {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    });
  } catch (error) {
    // The Stripe customer exists but its id was not persisted, leaving an
    // orphan until the sync job or customer.created webhook reconciles it.
    // Capture it so the orphan is observable for reconciliation, then rethrow.
    Sentry.captureException(error, {
      tags: { context: "stripe_customer_provision", ownerType: "organization" },
      extra: { organizationId: organization.id, stripeCustomerId: customer.id },
    });
    throw error;
  }

  return customer.id;
}
