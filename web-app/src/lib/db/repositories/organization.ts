import "server-only";

import {
  organizationInclude,
  organizationMembersCountInclude,
  organizationOrderBy,
  OrganizationWithRelations,
} from "@/lib/db/types";
import { Organization, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveOrganizationsWithRelations(
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations[]> {
  return await tx.organization.findMany({
    include: organizationInclude,
    orderBy: organizationOrderBy,
  });
}

export async function createOrganization(
  slug: string,
  name: string,
  requiredEmailDomains: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  return await tx.organization.create({
    data: { slug, name, requiredEmailDomains },
  });
}

export async function retrieveOrganizationsByEmailDomain(
  emailDomain: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations[]> {
  return await tx.organization.findMany({
    where: {
      requiredEmailDomains: { has: emailDomain },
    },
    include: { ...organizationMembersCountInclude },
  });
}

export async function retrieveOrganizationWithRelationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations | null> {
  return await tx.organization.findUnique({
    where: { id },
    include: organizationInclude,
  });
}

export async function retrieveOrganizationWithRelationsBySlug(
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations | null> {
  return await tx.organization.findUnique({
    where: { slug },
    include: organizationInclude,
  });
}

export async function updateOrganizationById(
  organizationId: string,
  data: Prisma.OrganizationUpdateInput,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.organization.update({
    where: { id: organizationId },
    data,
  });
}
