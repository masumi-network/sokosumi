import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

interface PersistPreferredOrganizationResult {
  ok: boolean;
  organizationId: string | null;
}

export const preferredOrganizationService = (() => {
  async function resolveActiveOrganizationIdForSession(
    _userId: string,
  ): Promise<string | null> {
    const response = await coreClient.getMyPreferredOrganization();
    return response.data.organizationId;
  }

  async function persistPreferredOrganizationId(
    _userId: string,
    organizationId: string | null,
  ): Promise<PersistPreferredOrganizationResult> {
    try {
      const response =
        await coreClient.patchMyPreferredOrganization(organizationId);

      return {
        ok: true,
        organizationId: response.data.organizationId,
      };
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 400) {
        return {
          ok: false,
          organizationId: null,
        };
      }

      throw error;
    }
  }

  return {
    resolveActiveOrganizationIdForSession,
    persistPreferredOrganizationId,
  };
})();
