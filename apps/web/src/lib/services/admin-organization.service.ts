import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export interface AdminOrganizationOption {
  id: string;
  name: string;
  slug: string;
}

export const adminOrganizationService = {
  async searchOrganizations(query: string): Promise<AdminOrganizationOption[]> {
    const result = await coreClient.searchAdminOrganizations(query);

    return result.data.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));
  },

  async getOrganizationOptionBySlug(
    slug: string,
  ): Promise<AdminOrganizationOption | null> {
    try {
      const result = await coreClient.getAdminOrganizationBySlug(slug);

      return {
        id: result.data.id,
        name: result.data.name,
        slug: result.data.slug,
      };
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  },
};
