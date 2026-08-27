import { resolveOrganizationBillingPlanWithActiveSubscription } from "@sokosumi/database/helpers";
import { APIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";

export async function ensureCanAcceptOrganizationInvitation(
  organizationId: string,
): Promise<void> {
  const { billingPlan, activeSubscription } =
    await resolveOrganizationBillingPlanWithActiveSubscription(
      organizationId,
      prisma,
    );

  if (billingPlan.mode === "enterprise_contract") {
    if (billingPlan.purchasedSeats < 1) {
      throw new APIError("BAD_REQUEST", {
        message:
          "Enterprise contract has no purchased seats configured for this organization.",
      });
    }

    return;
  }

  if (!activeSubscription) {
    throw new APIError("BAD_REQUEST", {
      message:
        "An active organization subscription is required before adding members.",
    });
  }
}
