import "server-only";

import z from "zod";

import prisma from "@/lib/db/prisma";
import { Organization, Prisma } from "@/prisma/generated/client";

import publicEmailDomains from "./public-email-domains.json";
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

const createOrganizationSchema = z.object({
  slug: z.string().min(1).max(150),
  name: z.string().min(1).max(150),
  requiredEmailDomains: z.array(z.string().min(1).max(150)).max(15),
});

function isDomain(domain: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(
    domain,
  );
}

function isPublicDomain(domain: string): boolean {
  return publicEmailDomains.includes(domain.toLowerCase());
}

export async function createOrganization(
  slug: string,
  name: string,
  requiredEmailDomains: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  const validated = createOrganizationSchema.parse({
    slug,
    name,
    requiredEmailDomains,
  });

  const invalidDomains = validated.requiredEmailDomains.filter(
    (domain) => !isDomain(domain) || isPublicDomain(domain),
  );

  if (invalidDomains.length > 0) throw new Error("Invalid domain selected");

  return await tx.organization.create({
    data: {
      slug: validated.slug,
      name: validated.name,
      requiredEmailDomains: validated.requiredEmailDomains,
    },
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
