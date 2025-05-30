"use server";

import { prisma } from "@/lib/db";
import { Organization, Prisma } from "@/prisma/generated/client";

import {
  organizationInclude,
  organizationMembersCountInclude,
  organizationOrderBy,
  OrganizationWithMembersCount,
  OrganizationWithRelations,
} from "./types";

export async function getOrganizationsWithMembersCount(
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithMembersCount[]> {
  return await tx.organization.findMany({
    include: {
      ...organizationMembersCountInclude,
    },
    orderBy: { ...organizationOrderBy },
  });
}

export async function createOrganization(
  name: string,
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  return await tx.organization.create({ data: { name, slug } });
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
