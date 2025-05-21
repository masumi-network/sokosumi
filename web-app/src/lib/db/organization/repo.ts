"use server";

import { prisma } from "@/lib/db";
import { Organization, Prisma } from "@/prisma/generated/client";

import {
  organizationMembersCountInclude,
  OrganizationWithMembersCount,
} from "./type";

export async function getAllOrganizations(
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithMembersCount[]> {
  return await tx.organization.findMany({
    orderBy: {
      members: {
        _count: "desc",
      },
    },
    include: {
      ...organizationMembersCountInclude,
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
