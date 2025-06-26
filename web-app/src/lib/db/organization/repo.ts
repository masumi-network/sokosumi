"use server";

import { prisma } from "@/lib/db";
import { Organization, Prisma } from "@/prisma/generated/client";

import {
  organizationInclude,
  organizationMembersCountInclude,
  organizationOrderBy,
  OrganizationWithRelations,
} from "./types";

export async function getOrganizationsWithMembersCount(
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

export async function getOrganizationBySlug(
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations | null> {
  return await tx.organization.findUnique({
    where: { slug },
    include: { ...organizationInclude },
  });
}

export async function updateOrganization(
  organizationId: string,
  data: Prisma.OrganizationUpdateInput,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.organization.update({
    where: { id: organizationId },
    data,
  });
}
