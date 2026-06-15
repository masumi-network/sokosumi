"use server";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import * as z from "zod";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toSubscriptionSeatsActionError } from "@/lib/actions/subscription/map-core-subscription-seats-error";
import type { SubscriptionChangeResult } from "@/lib/auth/subscription.server";
import {
  openOrganizationBillingPortalServer,
  openPersonalBillingPortalServer,
  upgradeOrganizationSubscriptionServer,
  upgradePersonalSubscriptionServer,
} from "@/lib/auth/subscription.server";
import { coreClient } from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export type { SubscriptionChangeResult } from "@/lib/auth/subscription.server";

export async function upgradePersonalSubscription({
  plan,
  returnPath,
}: {
  plan: PaidSubscriptionPlanName;
  returnPath?: string;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  return upgradePersonalSubscriptionServer({ plan, returnPath });
}

export async function upgradeOrganizationSubscription({
  organizationId,
  plan,
  returnPath,
  seats,
}: {
  organizationId: string;
  plan: PaidSubscriptionPlanName;
  returnPath: string;
  seats: number;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  return upgradeOrganizationSubscriptionServer({
    organizationId,
    plan,
    returnPath,
    seats,
  });
}

export async function openPersonalBillingPortal({
  returnPath,
}: {
  returnPath?: string;
}): Promise<Result<{ url: string }, ActionError>> {
  return openPersonalBillingPortalServer({ returnPath });
}

export async function openOrganizationBillingPortal({
  organizationId,
  returnPath,
}: {
  organizationId: string;
  returnPath: string;
}): Promise<Result<{ url: string }, ActionError>> {
  return openOrganizationBillingPortalServer({ organizationId, returnPath });
}

const updateOrganizationSubscriptionSeatsSchema = z.object({
  organizationId: z.string().min(1),
  seats: z.number().int().min(1),
});

interface UpdateOrganizationSubscriptionSeatsParameters
  extends AuthenticatedRequest {
  organizationId: string;
  seats: number;
}

export const updateOrganizationSubscriptionSeats = withSession<
  UpdateOrganizationSubscriptionSeatsParameters,
  Result<{ seats: number }, ActionError>
>(async ({ organizationId, seats }) => {
  const parsed = updateOrganizationSubscriptionSeatsSchema.safeParse({
    organizationId,
    seats,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const { data } = await coreClient.updateOrganizationSubscriptionSeats(
      parsed.data.organizationId,
      parsed.data.seats,
    );

    return Ok({ seats: data.seats });
  } catch (error) {
    return Err(toSubscriptionSeatsActionError(error));
  }
});
