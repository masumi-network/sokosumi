"use server";

import { prisma } from "@/lib/db";
import { Organization, Prisma } from "@/prisma/generated/client";

export async function getAllOrganizations(
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization[]> {
  return await tx.organization.findMany();
}

export async function createOrganization(
  name: string,
  slug: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  return await tx.organization.create({ data: { name, slug } });
}
