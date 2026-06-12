import "server-only";

import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";

interface PersistPreferredOrganizationResult {
  ok: boolean;
  organizationId: string | null;
}

export const preferredOrganizationService = (() => {
  /**
   * Reads stay local: this runs inside the Better Auth `session.create.before`
   * hook and must not leave the web process until the auth migration.
   */
  async function resolveActiveOrganizationIdForSession(
    userId: string,
  ): Promise<string | null> {
    const user = await userRepository.getUserById(userId, prisma);
    const preferredOrganizationId = user?.preferredOrganizationId ?? null;

    if (!preferredOrganizationId) {
      return null;
    }

    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      preferredOrganizationId,
      prisma,
    );

    return member ? preferredOrganizationId : null;
  }

  /**
   * Persists the current session user's preferred organization via core,
   * which owns the membership check + write transaction. `ok: false` means
   * the user is not a member of the organization.
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
    resolveActiveOrganizationIdForSession,
    persistPreferredOrganizationId,
  };
})();
