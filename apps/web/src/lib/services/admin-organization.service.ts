import "server-only";

import { organizationRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

export interface AdminOrganizationOption {
  id: string;
  name: string;
  slug: string;
}

export const adminOrganizationService = {
  async listOrganizations(): Promise<AdminOrganizationOption[]> {
    const organizations =
      await organizationRepository.listOrganizationsWithLimitedInfo(prisma);

    return organizations
      .map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};
