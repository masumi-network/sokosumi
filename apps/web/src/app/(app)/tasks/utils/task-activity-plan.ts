import "server-only";

import type { SubscriptionPlanName } from "@sokosumi/utils";

import { parsePlanName } from "@/components/billing/subscription-plan-utils";
import type { getSession } from "@/lib/auth/auth.server";
import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";

type SessionResult = Awaited<ReturnType<typeof getSession>>;

/**
 * Resolves the plan used for task-activity billing CTAs.
 *
 * Uses the non-redirecting Core client: a 403 here means the viewer is not a
 * member of the task's organization (admin review, revoked membership), not a
 * dead session. Routing that through the redirect proxy sends authenticated
 * admins to `/signin` → landing and looks like the detail page "crashes".
 */
export async function resolveTaskActivityPlan(
  session: SessionResult,
  organizationId: string | null,
): Promise<SubscriptionPlanName> {
  if (!session) {
    return "free";
  }

  try {
    const { data } = organizationId
      ? await coreClientNoRedirect.getOrganizationActiveSubscription(
          organizationId,
        )
      : await coreClientNoRedirect.getMyActiveSubscription();

    return parsePlanName(data.subscription?.plan) ?? "free";
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      return "free";
    }
    throw error;
  }
}
