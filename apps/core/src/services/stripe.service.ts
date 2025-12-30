import * as Sentry from "@sentry/node";
import prisma from "@sokosumi/database/client";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client.js";

/**
 * Service for managing Stripe customer creation and database persistence.
 * Ensures consistency between Stripe and the database by handling both operations together.
 */
export const stripeService = (() => {
  return {
    /**
     * Creates a Stripe customer for a user and saves the customer ID to the database.
     *
     * @param userId - The unique identifier of the user
     * @param name - The name of the user
     * @param email - The email address of the user
     * @returns The created Stripe customer object
     * @throws Error if Stripe customer creation or database save fails
     */
    async createUserCustomerAndSave(
      userId: string,
      name: string,
      email: string,
    ): Promise<Stripe.Customer> {
      try {
        // Create customer in Stripe
        const customer = await stripeClient.createUserCustomer(
          userId,
          name,
          email,
        );

        // Save customer ID to database
        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customer.id },
        });

        console.log(
          `✅ Created Stripe customer ${customer.id} for user ${userId}`,
        );

        return customer;
      } catch (error) {
        console.error(
          `Failed to create Stripe customer for user ${userId}:`,
          error,
        );

        Sentry.captureException(error, {
          tags: {
            context: "stripe_user_customer_creation",
            user_id: userId,
          },
          extra: {
            userId,
            email,
            name,
          },
        });

        throw error;
      }
    },

    /**
     * Creates a Stripe customer for an organization and saves the customer ID to the database.
     *
     * @param organizationId - The unique identifier of the organization
     * @param name - The name of the organization
     * @param invoiceEmail - The invoice email for the organization (optional)
     * @param slug - The organization slug
     * @returns The created Stripe customer object
     * @throws Error if Stripe customer creation or database save fails
     */
    async createOrganizationCustomerAndSave(
      organizationId: string,
      name: string,
      invoiceEmail: string | null,
      slug: string,
    ): Promise<Stripe.Customer> {
      try {
        // Create customer in Stripe
        const customer = await stripeClient.createOrganizationCustomer(
          organizationId,
          name,
          invoiceEmail,
          slug,
        );

        // Save customer ID to database
        await prisma.organization.update({
          where: { id: organizationId },
          data: { stripeCustomerId: customer.id },
        });

        console.log(
          `✅ Created Stripe customer ${customer.id} for organization ${organizationId}`,
        );

        return customer;
      } catch (error) {
        console.error(
          `Failed to create Stripe customer for organization ${organizationId}:`,
          error,
        );

        Sentry.captureException(error, {
          tags: {
            context: "stripe_organization_customer_creation",
            organization_id: organizationId,
          },
          extra: {
            organizationId,
            name,
            invoiceEmail,
            slug,
          },
        });

        throw error;
      }
    },
  };
})();
