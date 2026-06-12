import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

interface PersistPreferredOrganizationResult {
  ok: boolean;
  organizationId: string | null;
}

export const preferredOrganizationService = (() => {
  /**
   * Persists the current session user's preferred organization via core,
   * which owns the membership check + write transaction. `ok: false` means
   * the user is not a member of the organization.
   *
   * The session-bootstrap read (`resolveActiveOrganizationIdForSession`)
   * lives in core's auth instance (`auth-session.service`) since the Better
   * Auth migration.
   */
  async function persistPreferredOrganizationId(
    organizationId: string | null,
  ): Promise<PersistPreferredOrganizationResult> {
    try {
      const { data } =
        await coreClient.setMyPreferredOrganization(organizationId);
      return {
        ok: true,
        organizationId: data.organizationId,
      };
    } catch (error) {
      if (
        error instanceof CoreApiRequestError &&
        error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED
      ) {
        return {
          ok: false,
          organizationId: null,
        };
      }
      throw error;
    }
  }

  return {
    persistPreferredOrganizationId,
  };
})();
