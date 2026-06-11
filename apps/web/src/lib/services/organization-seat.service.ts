import "server-only";

import type { OrganizationBillingPlanName } from "@sokosumi/utils";
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
 */
function mapCoreSeatWriteError(error: unknown): never {
  if (!(error instanceof CoreApiRequestError)) {
    throw error;
  }

  if (
    error.status === 403 ||
    (error.status === 404 && error.message === "Organization not found")
  ) {
    throw new APIError("FORBIDDEN", {
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  }

  if (error.status === 404) {
    throw new APIError("NOT_FOUND", {
      message: error.message,
    });
  }

  if (error.status === 400) {
    throw new APIError("BAD_REQUEST", {
      message: error.message,
    });
  }

  throw error;
}

export const organizationSeatService = (() => {
  return {
    async getSeatSummary(
      organizationId: string,
    ): Promise<OrganizationSeatSummary> {
      const { data } =
        await coreClient.getOrganizationSeatSummary(organizationId);

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
