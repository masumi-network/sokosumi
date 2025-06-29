import "server-only";

import prisma from "@/lib/db/prisma";
import { Organization, Prisma } from "@/prisma/generated/client";

import publicEmailDomains from "./public-email-domains.json";
import {
  organizationInclude,
  organizationMembersCountInclude,
  OrganizationWithRelations,
} from "./types";

function isDomain(domain: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(
    domain,
  );
}

function isPublicDomain(domain: string): boolean {
  return publicEmailDomains.includes(domain.toLowerCase());
}

export async function getOrganizationsAllowedBySpecificEmailDomain(
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

export async function getOrganizationById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<OrganizationWithRelations | null> {
  return await tx.organization.findUnique({
    where: { id },
    include: { ...organizationMembersCountInclude },
  });
}

export async function createOrganization(
  slug: string,
  name: string,
  requiredEmailDomains: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<Organization> {
  return await tx.organization.create({
    data: {
      slug,
      name,
      requiredEmailDomains,
    },
  });
}
export function getInvalidDomains(
  requiredEmailDomains: string[] | null,
): string[] | null {
  if (!requiredEmailDomains) {
    return null;
  }
  const invalidDomains = requiredEmailDomains.filter(
    (domain) => !isDomain(domain) || isPublicDomain(domain),
  );
  return invalidDomains;
}

export function filterValidEmailDomains(
  requiredEmailDomains: string[] | null,
): string[] {
  if (!requiredEmailDomains) {
    return [];
  }
  const validDomains = requiredEmailDomains.filter(
    (domain) => isDomain(domain) && !isPublicDomain(domain),
  );
  return validDomains;
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
