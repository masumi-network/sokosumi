import "server-only";

import {
  organizationInclude,
  organizationMembersCountInclude,
  OrganizationWithRelations,
} from "@/lib/db/types";
import { Organization, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const organizationRepository = {
  async createOrganization(
    slug: string,
    name: string,
    requiredEmailDomains: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Organization> {
    return await tx.organization.create({
      data: { slug, name, requiredEmailDomains },
    });
  },

  async getOrganizationsByEmailDomain(
    emailDomain: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations[]> {
    return await tx.organization.findMany({
      where: {
        requiredEmailDomains: { has: emailDomain },
      },
      include: { ...organizationMembersCountInclude },
    });
  },

  async getUniqueOrganizationWithRelations(
    where: Prisma.OrganizationWhereUniqueInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await tx.organization.findUnique({
      where,
      include: organizationInclude,
    });
  },

  async getOrganizationWithRelationsById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await this.getUniqueOrganizationWithRelations({ id }, tx);
  },

  async getOrganizationWithRelationsBySlug(
    slug: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<OrganizationWithRelations | null> {
    return await this.getUniqueOrganizationWithRelations({ slug }, tx);
  },

  async updateOrganizationById(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.organization.update({
      where: { id: organizationId },
      data,
    });
  },
};
