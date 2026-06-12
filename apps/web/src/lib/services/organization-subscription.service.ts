import "server-only";

import {
  ensureLocalFreeSubscriptionPeriod,
  grantFreeOrganizationMemberSubscriptionCredits,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";

interface ActiveOrganizationSubscription {
  createdAt: Date;
  id: string;
  periodEnd: Date | null;
  periodStart: Date | null;
  seats: number | null;
  stripeSubscriptionId: string | null;
}

async function resolveActiveOrganizationSubscription(
  organizationId: string,
): Promise<ActiveOrganizationSubscription | null> {
  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      prisma,
    );

  if (!subscription) {
    return null;
  }

  return {
    createdAt: subscription.createdAt,
    id: subscription.id,
    periodEnd: subscription.periodEnd,
    periodStart: subscription.periodStart,
    seats: subscription.seats,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  };
}

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

async function ensureActiveOrganizationSubscription(
  organizationId: string,
  missingSubscriptionMessage: string,
): Promise<ActiveOrganizationSubscription> {
  const activeSubscription =
    await resolveActiveOrganizationSubscription(organizationId);
  if (!activeSubscription) {
    throw new APIError("BAD_REQUEST", {
      message: missingSubscriptionMessage,
    });
  }

  return activeSubscription;
}

function ensureSubscriptionPeriodDate(
  value: Date | null,
  fieldName: string,
): Date {
  if (value instanceof Date) {
    return value;
  }

  throw new APIError("INTERNAL_SERVER_ERROR", {
    message: `Organization subscription is missing its ${fieldName}. Please contact support.`,
  });
}

async function syncPaidOrganizationUnassignedFreeCredits(
  organizationId: string,
  activeSubscription: ActiveOrganizationSubscription,
): Promise<number> {
  const purchasedSeats = resolvePurchasedSeats(activeSubscription.seats);
  const periodEnd = activeSubscription.periodEnd;

  if (!periodEnd || periodEnd <= new Date()) {
    return purchasedSeats;
  }

  await prisma.$transaction(async (tx) => {
    const unassignedMemberUserIds =
      await memberRepository.getUnassignedMemberUserIds(organizationId, tx);

    await grantFreeOrganizationMemberSubscriptionCredits(
      {
        memberUserIds: unassignedMemberUserIds,
        organizationId,
        periodEnd,
      },
      tx,
    );
  });

  return purchasedSeats;
}

async function syncLocalFreeOrganizationPeriodCredits(
  organizationId: string,
  activeSubscription: ActiveOrganizationSubscription,
): Promise<number> {
  const periodStart = ensureSubscriptionPeriodDate(
    activeSubscription.periodStart,
    "period start",
  );
  const periodEnd = ensureSubscriptionPeriodDate(
    activeSubscription.periodEnd,
    "period end",
  );
  const purchasedSeats = resolvePurchasedSeats(activeSubscription.seats);

  return await prisma.$transaction(async (tx) => {
    const memberUserIds = await memberRepository.getOrganizationMemberUserIds(
      organizationId,
      tx,
    );

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: activeSubscription.createdAt,
        memberUserIds,
        organizationId,
        periodEnd,
        periodStart,
        purchasedSeats,
        referenceId: organizationId,
      },
      tx,
    );

    return purchasedSeats;
  });
}

async function syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(
  organizationId: string,
  activeSubscription?: ActiveOrganizationSubscription | null,
): Promise<number> {
  const billingPlan = await resolveOrganizationBillingPlan(
    organizationId,
    prisma,
  );
  if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable) {
    return resolvePurchasedSeats(billingPlan.purchasedSeats);
  }

  const currentActiveSubscription =
    activeSubscription ??
    (await resolveActiveOrganizationSubscription(organizationId));

  if (!currentActiveSubscription) {
    return resolvePurchasedSeats(undefined);
  }

  if (currentActiveSubscription.stripeSubscriptionId) {
    return syncPaidOrganizationUnassignedFreeCredits(
      organizationId,
      currentActiveSubscription,
    );
  }

  return syncLocalFreeOrganizationPeriodCredits(
    organizationId,
    currentActiveSubscription,
  );
}

export const organizationSubscriptionService = (() => {
  return {
    /**
     * Immediately updates the purchased seat count via the Core API. Core
     * owns the authorization (owner/admin), the enterprise-contract
     * exclusivity and assigned-member guards, the Stripe quantity update,
     * and the local seat write.
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

    async ensureCanCreateInvitation(_organizationId: string): Promise<void> {
      return;
    },

    async ensureCanAcceptInvitation(organizationId: string): Promise<void> {
      const billingPlan = await resolveOrganizationBillingPlan(
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

      await ensureActiveOrganizationSubscription(
        organizationId,
        "An active organization subscription is required before adding members.",
      );
    },

    async syncLocalFreeSeatsAndCreditsForCurrentMembers(
      organizationId: string,
    ): Promise<void> {
      await syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(
        organizationId,
      );
    },
  };
})();
