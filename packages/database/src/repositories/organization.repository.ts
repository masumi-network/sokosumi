import type { Organization, Prisma } from "../generated/prisma/client.js";
import {
  type OrganizationWithLimitedInfo,
  type OrganizationWithRelations,
  organizationInclude,
  organizationLimitedInfoInclude,
} from "../types/organization.js";

export const organizationRepository = {
  async getUniqueOrganizationWithRelations(
    where: Prisma.OrganizationWhereUniqueInput,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationWithRelations | null> {
    return await tx.organization.findUnique({
      where,
      include: organizationInclude,
    });
  },

  async getOrganizationWithRelationsById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationWithRelations | null> {
    return await this.getUniqueOrganizationWithRelations({ id }, tx);
  },

  /**
   * Limited info by slug, for seeding a combobox with the already-selected org.
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

  async getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Organization | null> {
    return await tx.organization.findUnique({
      where: { stripeCustomerId },
    });
  },

  /**
   * Admin overview listing. An empty query lists all organizations. Ordered
   * newest-first.
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
