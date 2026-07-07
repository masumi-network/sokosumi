import type { Organization, Prisma } from "../generated/prisma/client.js";
import {
  type OrganizationWithLimitedInfo,
  type OrganizationWithRelations,
  organizationInclude,
  organizationLimitedInfoInclude,
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

  /**
   * Searches organizations by name or slug using a case-insensitive partial
   * match.
   *
   * @param query - The search term to match against organization name and slug.
   * @param limit - The maximum number of organizations to return.
   * @param tx - The Prisma transaction client to use.
   * @returns A promise that resolves to matching organizations (limited info).
   *   An empty or whitespace-only query resolves to an empty array without
   *   querying.
   */
  async searchOrganizations(
    query: string,
    limit: number,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationWithLimitedInfo[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    return await tx.organization.findMany({
      where: {
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { slug: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      select: organizationLimitedInfoInclude,
      orderBy: { name: "asc" },
      take: limit,
    });
  },

  /**
   * Retrieves a single organization's limited info by slug. Used to seed a
   * combobox with an already-selected organization without loading the full
   * list.
   *
   * @param slug - The slug of the organization.
   * @param tx - The Prisma transaction client to use.
   * @returns The organization's limited info if found, otherwise null.
   */
  async getOrganizationLimitedInfoBySlug(
    slug: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationWithLimitedInfo | null> {
    return await tx.organization.findUnique({
      where: { slug },
      select: organizationLimitedInfoInclude,
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
   * Paginated organization listing for the admin organization overview. An
   * empty or missing query lists all organizations (unlike `searchOrganizations`,
   * which is a picker and returns nothing for blank queries). Ordered newest-first.
   */
  async listOrganizationsForAdminOverview(
    params: {
      query?: string;
      cursor?: string;
      take: number;
      skip?: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{
    organizations: Array<
      Pick<Organization, "id" | "name" | "slug" | "createdAt"> & {
        _count: { members: number };
      }
    >;
    total: number;
  }> {
    const trimmed = params.query?.trim();
    const where: Prisma.OrganizationWhereInput = trimmed
      ? {
          OR: [
            { name: { contains: trimmed, mode: "insensitive" } },
            { slug: { contains: trimmed, mode: "insensitive" } },
          ],
        }
      : {};

    const [organizations, total] = await Promise.all([
      tx.organization.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          _count: {
            select: {
              members: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.take,
        skip: params.skip,
        cursor: params.cursor ? { id: params.cursor } : undefined,
      }),
      tx.organization.count({ where }),
    ]);

    return { organizations, total };
  },
};
