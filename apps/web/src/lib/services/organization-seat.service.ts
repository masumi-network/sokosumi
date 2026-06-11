import "server-only";

import {
  CORE_API_ERROR_KINDS,
  type OrganizationBillingPlanName,
} from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export interface OrganizationSeatSummary {
  assignedCount: number;
  memberCount: number;
  isEnterpriseContract: boolean;
  paidPlan: OrganizationBillingPlanName | null;
  purchasedSeats: number;
  unusedSeats: number;
}

/**
 * Maps Core seat-write errors back onto the APIError statuses callers (the
 * seat actions) expect. Core responds 403 when the caller is not an owner or
 * admin and 404 when the organization is missing — both surfaced as FORBIDDEN
 * like the previous in-process guard. A 404 for the member and a 400 for
 * exhausted capacity keep Core's message.
 *
 * Disambiguation matches the machine-readable `kind` from the Core error
 * envelope first; the legacy status(+message) checks remain as a fallback for
 * responses without a kind.
 */
function mapCoreSeatWriteError(error: unknown): never {
  if (!(error instanceof CoreApiRequestError)) {
    throw error;
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
    error.status === 403 ||
    (error.status === 404 && error.message === "Organization not found")
  ) {
    throw new APIError("FORBIDDEN", {
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.MEMBER_NOT_FOUND ||
    error.status === 404
  ) {
    throw new APIError("NOT_FOUND", {
      message: error.message,
    });
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.SEAT_CAPACITY_EXCEEDED ||
    error.status === 400
  ) {
    throw new APIError("BAD_REQUEST", {
      message: error.message,
    });
  }

  throw error;
}

export const organizationSeatService = (() => {
  return {
    /**
     * Returns the seat summary, or `null` when Core reports the caller has no
     * access to the organization (403) or the organization is missing (404) —
     * e.g. a stale active organization after a revoked membership. Callers
     * render a no-seat-data fallback in that case.
     */
    async getSeatSummary(
      organizationId: string,
    ): Promise<OrganizationSeatSummary | null> {
      let data: Awaited<
        ReturnType<typeof coreClient.getOrganizationSeatSummary>
      >["data"];
      try {
        ({ data } =
          await coreClient.getOrganizationSeatSummary(organizationId));
      } catch (error) {
        if (
          error instanceof CoreApiRequestError &&
          (error.status === 403 || error.status === 404)
        ) {
          return null;
        }
        throw error;
      }

      return {
        assignedCount: data.assignedCount,
        memberCount: data.memberCount,
        isEnterpriseContract: data.isEnterpriseContract,
        paidPlan: data.paidPlan,
        purchasedSeats: data.purchasedSeats,
        unusedSeats: data.unusedSeats,
      };
    },

    async assignSeat(
      _userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string; seatAssignedAt: Date }> {
      try {
        const { data } = await coreClient.assignOrganizationSeat(
          organizationId,
          memberId,
        );

        return {
          memberId: data.memberId,
          seatAssignedAt: new Date(data.seatAssignedAt),
        };
      } catch (error) {
        mapCoreSeatWriteError(error);
      }
    },

    async unassignSeat(
      _userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string }> {
      try {
        const { data } = await coreClient.unassignOrganizationSeat(
          organizationId,
          memberId,
        );

        return {
          memberId: data.memberId,
        };
      } catch (error) {
        mapCoreSeatWriteError(error);
      }
    },
  };
})();
