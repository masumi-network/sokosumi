import "server-only";

import type { OrganizationBillingPlan } from "@sokosumi/database/helpers";
import { getUnusedSeatCount } from "@sokosumi/database/helpers";
import type { OrganizationBillingPlanName } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";

export interface OrganizationSeatSummary {
  assignedCount: number;
  memberCount: number;
  isEnterpriseContract: boolean;
  paidPlan: OrganizationBillingPlanName | null;
  purchasedSeats: number;
  unusedSeats: number;
}

function resolveOrganizationPaidPlanLabel(
  plan: OrganizationBillingPlanName,
): OrganizationBillingPlanName | null {
  if (plan === "free") {
    return null;
  }

  return plan;
}

async function ensureCanManageSeatAssignments(
  userId: string,
  organizationId: string,
): Promise<void> {
  const response = await coreClient.getMyMemberInOrganization(organizationId);
  const member = response?.data ?? null;

  if (!member || !isOrganizationOwnerOrAdmin(member.role)) {
    throw new APIError("FORBIDDEN", {
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  }
}

function mapSeatApiError(error: unknown): never {
  if (error instanceof CoreApiRequestError) {
    if (error.status === 403) {
      throw new APIError("FORBIDDEN", {
        message: error.message,
      });
    }

    if (error.status === 404) {
      throw new APIError("NOT_FOUND", {
        message: "Member not found",
      });
    }

    if (error.status === 400) {
      throw new APIError("BAD_REQUEST", {
        message:
          error.message.includes("exceeds purchased seats") ||
          error.message.includes("unused seats")
            ? "No unused seats available. Purchase more seats or unassign another member."
            : error.message,
      });
    }
  }

  if (error instanceof Error && error.message === "Member not found") {
    throw new APIError("NOT_FOUND", {
      message: "Member not found",
    });
  }

  throw error;
}

function countAssignedSeats(
  members: Array<{ seatAssignedAt: string | Date | null }>,
): number {
  return members.filter((member) => member.seatAssignedAt != null).length;
}

export const organizationSeatService = (() => {
  return {
    async getSeatSummary(
      organizationId: string,
    ): Promise<OrganizationSeatSummary> {
      const [membersResponse, billingPlanResponse] = await Promise.all([
        coreClient.getOrganizationMembers(organizationId),
        coreClient.getOrganizationBillingPlan(organizationId),
      ]);

      const members = membersResponse.data;
      const billingPlan = billingPlanResponse.data as OrganizationBillingPlan;
      const assignedCount = countAssignedSeats(members);
      const memberCount = members.length;
      const paidPlan = resolveOrganizationPaidPlanLabel(billingPlan.plan);
      const purchasedSeats = billingPlan.purchasedSeats;
      const hasSeatEntitlements = paidPlan != null;

      return {
        assignedCount: hasSeatEntitlements ? assignedCount : 0,
        memberCount,
        isEnterpriseContract: billingPlan.mode === "enterprise_contract",
        paidPlan,
        purchasedSeats,
        unusedSeats: hasSeatEntitlements
          ? getUnusedSeatCount(purchasedSeats, assignedCount)
          : 0,
      };
    },

    async assignSeat(
      userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string; seatAssignedAt: Date }> {
      await ensureCanManageSeatAssignments(userId, organizationId);

      try {
        const response = await coreClient.assignOrganizationMemberSeat(
          organizationId,
          memberId,
        );

        return {
          memberId: response.data.memberId,
          seatAssignedAt: new Date(response.data.seatAssignedAt),
        };
      } catch (error) {
        mapSeatApiError(error);
      }
    },

    async unassignSeat(
      userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string }> {
      await ensureCanManageSeatAssignments(userId, organizationId);

      try {
        const response = await coreClient.unassignOrganizationMemberSeat(
          organizationId,
          memberId,
        );

        return {
          memberId: response.data.memberId,
        };
      } catch (error) {
        mapSeatApiError(error);
      }
    },
  };
})();
