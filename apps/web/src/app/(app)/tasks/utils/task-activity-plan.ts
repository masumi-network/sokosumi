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
 * Resolves the viewer's plan for task-activity billing CTAs.
 *
 * Returns `null` when the plan is unavailable (no session, or the viewer
 * cannot resolve the task's organization subscription). Do not treat those as
 * `"free"` — that would show an "upgrade plan" CTA for admins / outsiders.
 *
 * Uses the non-redirecting Core client: a 403 here is a membership miss, not a
 * dead session. Routing it through the redirect proxy sends authenticated
 * admins to `/signin` → landing.
 */
export async function resolveTaskActivityPlan(
  session: SessionResult,
  organizationId: string | null,
): Promise<SubscriptionPlanName | null> {
  if (!session) {
    return null;
  }

  try {
    const { data } = organizationId
      ? await coreClientNoRedirect.getOrganizationActiveSubscription(
          organizationId,
        )
      : await coreClientNoRedirect.getMyActiveSubscription();

    // Member who can resolve the subscription: null plan from Core means free.
    return parsePlanName(data.subscription?.plan) ?? "free";
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}
