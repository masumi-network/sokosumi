import "server-only";

import {
  organizationInclude,
  organizationMembersCountInclude,
  organizationOrderBy,
  OrganizationWithRelations,
} from "@/lib/db/types";
import { Organization, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveOrganizationsWithMembersCount(
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations[]> {
  return await tx.organization.findMany({
    include: {
      ...organizationMembersCountInclude,
    },
    orderBy: { ...organizationOrderBy },
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

export async function retrieveOrganizationBySlug(
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations | null> {
  return await tx.organization.findUnique({
    where: { slug },
    include: { ...organizationInclude },
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
