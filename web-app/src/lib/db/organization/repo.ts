"use server";

import { prisma } from "@/lib/db";
import { Organization, Prisma } from "@/prisma/generated/client";

import {
  organizationInclude,
  organizationOrderBy,
  OrganizationWithRelations,
} from "./types";

export async function getAllOrganizations(
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations[]> {
  return await tx.organization.findMany({
    orderBy: { ...organizationOrderBy },
    include: {
      ...organizationInclude,
    },
  });
}

export async function createOrganization(
  name: string,
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  return await tx.organization.create({ data: { name, slug } });
}
