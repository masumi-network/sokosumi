import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

/**
 * Maps Core subscription-seat write errors back onto the APIError statuses
 * callers (the subscription action) expect. Core responds 403 when the caller
 * is not an owner or admin and 404 when the organization is missing — both
 * surfaced as FORBIDDEN like the previous in-process guard. A 400 (no active
 * subscription, seats below assigned members, or enterprise exclusivity)
 * keeps Core's message.
 *
 * Disambiguation matches the machine-readable `kind` from the Core error
 * envelope first; the legacy status(+message) checks remain as a fallback for
 * responses without a kind.
 */
function mapCoreSubscriptionSeatsWriteError(error: unknown): never {
  if (!(error instanceof CoreApiRequestError)) {
    throw error;
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
    error.status === 403 ||
    (error.status === 404 && error.message === "Organization not found")
  ) {
    throw new APIError("FORBIDDEN", {
      message: "Only organization owners and admins can manage subscriptions",
    });
  }

  if (error.status === 400) {
    throw new APIError("BAD_REQUEST", {
      message: error.message,
    });
  }

  throw error;
}

export const organizationSubscriptionService = (() => {
  return {
    /**
     * Immediately updates the purchased seat count via the Core API. Core
     * owns the authorization (owner/admin), the enterprise-contract
     * exclusivity and assigned-member guards, the Stripe quantity update,
     * and the local seat write.
     *
     * The Better Auth organization hooks that used to live here
     * (ensureCanAcceptInvitation, syncLocalFreeSeatsAndCreditsForCurrentMembers)
     * moved to core's auth instance with the Better Auth migration
     * (`apps/core/src/services/organization-subscription-hooks.service.ts`).
     */
    async updateOrganizationSeatsImmediately(
      _userId: string,
      organizationId: string,
      seats: number,
    ): Promise<{ seats: number }> {
      try {
        const { data } = await coreClient.updateOrganizationSubscriptionSeats(
          organizationId,
          seats,
        );

        return { seats: data.seats };
      } catch (error) {
        mapCoreSubscriptionSeatsWriteError(error);
      }
    },
  };
})();
