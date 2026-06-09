import "server-only";

import { organizationRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

export interface AdminOrganizationOption {
  id: string;
  name: string;
  slug: string;
}

const SEARCH_LIMIT = 20;

export const adminOrganizationService = {
  async searchOrganizations(query: string): Promise<AdminOrganizationOption[]> {
    const organizations = await organizationRepository.searchOrganizations(
      query,
      SEARCH_LIMIT,
      prisma,
    );

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));
  },

  async getOrganizationOptionBySlug(
    slug: string,
  ): Promise<AdminOrganizationOption | null> {
    const organization =
      await organizationRepository.getOrganizationLimitedInfoBySlug(
        slug,
        prisma,
      );

    if (!organization) {
      return null;
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    };
  },
};
