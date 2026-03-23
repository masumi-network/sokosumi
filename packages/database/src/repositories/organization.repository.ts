import type { Organization, Prisma } from "../generated/prisma/client.js";
import {
  organizationInclude,
  organizationLimitedInfoInclude,
  OrganizationWithLimitedInfo,
  OrganizationWithRelations,
} from "../types/organization.js";

function parseOrganizationMetadataToObject(
  metadata: string | null,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  try {
    const parsedMetadata = JSON.parse(metadata) as unknown;
    if (
      parsedMetadata &&
      typeof parsedMetadata === "object" &&
      !Array.isArray(parsedMetadata)
    ) {
      return parsedMetadata as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}

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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
  ) {
    return await tx.organization.update({
      where: { id: organizationId },
      data,
      include: organizationInclude,
    });
  },

  async listOrganizationsWithLimitedInfo(
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationWithLimitedInfo[]> {
    return await tx.organization.findMany({
      select: organizationLimitedInfoInclude,
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
    tx: Prisma.TransactionClient,
  ): Promise<Organization> {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { metadata: true },
    });

    const parsedMetadata = parseOrganizationMetadataToObject(
      organization?.metadata ?? null,
    );

    if (invoiceEmail) {
      parsedMetadata.invoiceEmail = invoiceEmail;
    } else {
      delete parsedMetadata.invoiceEmail;
    }

    const nextMetadata =
      Object.keys(parsedMetadata).length > 0
        ? JSON.stringify(parsedMetadata)
        : null;

    return await tx.organization.update({
      where: { id: organizationId },
      data: { metadata: nextMetadata },
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
  ): Promise<Organization[]> {
    return await tx.organization.findMany({
      where: {
        stripeCustomerId: null,
      },
    });
  },

  /**
   * Retrieves a page of organization IDs ordered by ID, starting after an optional cursor.
   *
   * @param cursorId - The last processed organization ID, or null to start from the beginning.
   * @param limit - The maximum number of organizations to return.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of organizations containing only IDs.
   */
  async getOrganizationsBatchAfterCursor(
    cursorId: string | null,
    limit: number,
    tx: Prisma.TransactionClient,
  ): Promise<Array<Pick<Organization, "id">>> {
    return await tx.organization.findMany({
      where: cursorId
        ? {
            id: {
              gt: cursorId,
            },
          }
        : undefined,
      orderBy: {
        id: "asc",
      },
      select: {
        id: true,
      },
      take: limit,
    });
  },
};
