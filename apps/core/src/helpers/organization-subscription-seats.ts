import { MemberRole } from "@sokosumi/database";
import {
  assertOrganizationSubscriptionChangeAllowed,
  OrganizationSubscriptionExclusivityError,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, internalServerError } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";

/**
 * The checks shared by previewing and applying a seat change: the caller is an
 * organization owner or admin, no enterprise contract blocks self-serve
 * changes, and the organization has an active subscription.
 */
export async function resolveSubscriptionForSeatChange(params: {
  organizationId: string;
  userId: string;
}) {
  const { organization } = await resolveMemberOrganizationById({
    id: params.organizationId,
    userId: params.userId,
    tx: prisma,
    allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
  });

  try {
    await assertOrganizationSubscriptionChangeAllowed(organization.id, prisma);
  } catch (error) {
    if (error instanceof OrganizationSubscriptionExclusivityError) {
      throw badRequest(error.message, {
        kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED,
      });
    }
    throw error;
  }

  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organization.id,
      prisma,
    );
  if (!subscription) {
    throw badRequest(
      "An active organization subscription is required to change seats.",
      { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE },
    );
  }

  return { organization, subscription };
}

/** The Stripe subscription item whose quantity is the purchased seat count. */
export async function retrieveStripeSeatItem(stripeSubscriptionId: string) {
  const stripeSubscription =
    await stripeClient.retrieveSubscriptionWithItems(stripeSubscriptionId);

  const firstItem = stripeSubscription.items.data[0];
  if (!firstItem) {
    throw internalServerError(
      "Unable to change organization subscription seats: missing Stripe subscription item",
    );
  }

  return firstItem;
}
