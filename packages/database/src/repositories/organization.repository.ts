
import prisma from "../client.js";
import type { Organization, Prisma } from "../generated/prisma/client.js";
import {
  organizationInclude,
  organizationLimitedInfoInclude,
  OrganizationWithLimitedInfo,
  OrganizationWithRelations,
} from "../types/organization.js";

/**
 * Repository for managing Organization entities and related queries.
 * Provides methods for creating organizations, fetching organizations with relations
 * and updating organization data.
 */
export const organizationRepository = {
  /**
   * Creates a new organization with the specified slug, name, and metadata.
   *
   * @param slug - The unique slug for the organization.
   * @param name - The name of the organization.
   * @param metadata - The metadata of the organization.
   * @param tx - Optional Prisma transaction client for transactional operations.
   * @returns The created Organization object.
   */
  async createOrganization(
    slug: string,
    name: string,
    metadata: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization> {
    return await tx.organization.create({
      data: { slug, name, metadata },
      include: organizationInclude,
    });
  },

  /**
   * Retrieves a unique organization with its relations based on a unique identifier.
   *
   * @param where - Unique input to identify the organization (e.g., id or slug).
   * @param tx - Optional Prisma transaction client.
   * @returns The OrganizationWithRelations object if found, otherwise null.
   */
  async getUniqueOrganizationWithRelations(
    where: Prisma.OrganizationWhereUniqueInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await tx.organization.findUnique({
      where,
      include: organizationInclude,
    });
  },

  /**
   * Retrieves an organization with its relations by organization ID.
   *
   * @param id - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns The OrganizationWithRelations object if found, otherwise null.
   */
  async getOrganizationWithRelationsById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await this.getUniqueOrganizationWithRelations({ id }, tx);
  },

  /**
   * Retrieves an organization with its relations by organization slug.
   *
   * @param slug - The slug of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns The OrganizationWithRelations object if found, otherwise null.
   */
  async getOrganizationWithRelationsBySlug(
    slug: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await this.getUniqueOrganizationWithRelations({ slug }, tx);
  },

  /**
   * Updates an organization by its ID with the provided data.
   *
   * @param organizationId - The ID of the organization to update.
   * @param data - The update data for the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns The updated OrganizationWithRelations object.
   */
  async updateOrganizationById(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.organization.update({
      where: { id: organizationId },
      data,
      include: organizationInclude,
    });
  },

  async listOrganizationsWithLimitedInfo(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithLimitedInfo[]> {
    return await tx.organization.findMany({
      select: organizationLimitedInfoInclude,
    });
  },

  /**
   * Sets the Stripe customer ID for an organization.
   *
   * @param organizationId - The ID of the organization to update.
   * @param stripeCustomerId - The Stripe customer ID to set.
   * @param tx - Optional Prisma transaction client.
   * @returns The updated Organization object.
   */
  async setOrganizationStripeCustomerId(
    organizationId: string,
    stripeCustomerId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization> {
    return await tx.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId },
    });
  },

  /**
   * Updates the invoice email for an organization.
   *
   * @param organizationId - The ID of the organization to update.
   * @param invoiceEmail - The invoice email to set (or null to clear).
   * @param tx - Optional Prisma transaction client.
   * @returns The updated Organization object.
   */
  async updateOrganizationInvoiceEmail(
    organizationId: string,
    invoiceEmail: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization> {
    return await tx.organization.update({
      where: { id: organizationId },
      data: { invoiceEmail },
    });
  },

  /**
   * Get an organization by its Stripe customer ID.
   *
   * @param stripeCustomerId - The Stripe customer ID.
   * @param tx - Optional Prisma transaction client.
   * @returns The organization if found, null otherwise.
   */
  async getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization | null> {
    return await tx.organization.findUnique({
      where: { stripeCustomerId },
    });
  },

  /**
   * Retrieves all organizations that do not have a Stripe customer ID.
   *
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of Organization objects without Stripe customer IDs.
   */
  async getOrganizationsWithoutStripeCustomerId(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization[]> {
    return await tx.organization.findMany({
      where: {
        stripeCustomerId: null,
      },
    });
  },
};
