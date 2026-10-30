import * as Sentry from "@sentry/node";
import { MemberRole } from "@sokosumi/database";
import {
  assertOrganizationSubscriptionChangeAllowed,
  OrganizationSubscriptionExclusivityError,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type Stripe from "stripe";

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

/**
 * The Stripe subscription and the item whose quantity is the purchased seat
 * count.
 */
export async function retrieveStripeSeatSubscription(
  stripeSubscriptionId: string,
) {
  const stripeSubscription =
    await stripeClient.retrieveSubscriptionWithItems(stripeSubscriptionId);

  const seatItem = stripeSubscription.items.data[0];
  if (!seatItem) {
    throw internalServerError(
      "Unable to change organization subscription seats: missing Stripe subscription item",
    );
  }

  return { seatItem, stripeSubscription };
}

/** A pending seat reduction, read from its Stripe subscription schedule. */
export interface ScheduledSeatReduction {
  effectiveAt: Date;
  seats: number;
}

// `source` is the marker the Better Auth Stripe plugin looks for: it releases a
// schedule that carries it before switching plans. Stripe's portal cannot
// update a subscription with a scheduled change, so without it a pending
// reduction would block every plan switch.
const SEAT_REDUCTION_SCHEDULE_METADATA = {
  purpose: "seat_reduction",
  source: "@better-auth/stripe",
};

function isSeatReductionSchedule(schedule: Stripe.SubscriptionSchedule) {
  return (
    schedule.metadata?.purpose === SEAT_REDUCTION_SCHEDULE_METADATA.purpose
  );
}

function resolveStripeId(value: string | { id: string }) {
  return typeof value === "string" ? value : value.id;
}

/** The active schedule holding a seat reduction. Other schedules read as null. */
async function retrieveSeatReductionSchedule(
  stripeSubscription: Pick<Stripe.Subscription, "schedule">,
) {
  if (!stripeSubscription.schedule) {
    return null;
  }

  const schedule = await stripeClient.retrieveSubscriptionSchedule(
    resolveStripeId(stripeSubscription.schedule),
  );
  return schedule.status === "active" && isSeatReductionSchedule(schedule)
    ? schedule
    : null;
}

/**
 * The reduction a schedule still has to apply. Null once the last phase is
 * running: Stripe only releases a schedule when that phase ends, a full
 * billing period after the seats dropped.
 */
export function resolveScheduledSeatReduction(
  schedule: Stripe.SubscriptionSchedule,
): ScheduledSeatReduction | null {
  if (schedule.status !== "active" || !isSeatReductionSchedule(schedule)) {
    return null;
  }

  const currentPhaseEnd = schedule.current_phase?.end_date;
  const lastPhase = schedule.phases.at(-1);
  const seats = lastPhase?.items[0]?.quantity;
  if (!currentPhaseEnd || !seats || lastPhase?.start_date !== currentPhaseEnd) {
    return null;
  }

  return {
    effectiveAt: new Date(currentPhaseEnd * 1000),
    seats,
  };
}

/** Purchased seats now, and the reduction waiting for the next renewal. */
export async function resolveOrganizationSubscriptionSeats(
  organizationId: string,
) {
  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      prisma,
    );
  if (!subscription) {
    throw badRequest(
      "An active organization subscription is required before reading seats.",
      { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE },
    );
  }

  let scheduledReduction: ScheduledSeatReduction | null = null;
  if (subscription.stripeScheduleId) {
    try {
      scheduledReduction = resolveScheduledSeatReduction(
        await stripeClient.retrieveSubscriptionSchedule(
          subscription.stripeScheduleId,
        ),
      );
    } catch (error) {
      // The billing page must still open when Stripe does not answer. It
      // then shows the purchased seats without the pending reduction.
      Sentry.captureException(error, {
        tags: { context: "organization_scheduled_seats_read" },
        extra: { organizationId },
      });
    }
  }

  return {
    scheduledReduction,
    seats: resolvePurchasedSeats(subscription.seats),
  };
}

/**
 * The running phase unchanged, then `seats` from the next renewal. Prices come
 * from the last phase, which is where a scheduled plan change would be.
 */
function buildPhasesWithRenewalSeats(
  schedule: Stripe.SubscriptionSchedule,
  seats: number,
) {
  // A schedule keeps its finished phases, so find the running one by its start.
  const currentPhase = schedule.phases.find(
    (phase) => phase.start_date === schedule.current_phase?.start_date,
  );
  const lastPhase = schedule.phases.at(-1);
  if (!currentPhase || !lastPhase) {
    throw internalServerError(
      "Unable to change organization subscription seats: Stripe schedule has no current phase",
    );
  }

  const settings = {
    automatic_tax: { enabled: true },
    // Omitting a setting here clears it, so a discount has to be carried over.
    discounts: currentPhase.discounts.map(
      ({ coupon, discount, promotion_code }) => {
        if (discount) {
          return { discount: resolveStripeId(discount) };
        }
        if (promotion_code) {
          return { promotion_code: resolveStripeId(promotion_code) };
        }
        return { coupon: coupon ? resolveStripeId(coupon) : undefined };
      },
    ),
    proration_behavior: "none" as const,
  };

  return [
    {
      ...settings,
      end_date: currentPhase.end_date,
      items: currentPhase.items.map((item) => ({
        price: resolveStripeId(item.price),
        quantity: item.quantity,
      })),
      start_date: currentPhase.start_date,
    },
    {
      ...settings,
      items: lastPhase.items.map((item) => ({
        price: resolveStripeId(item.price),
        quantity: seats,
      })),
    },
  ];
}

/**
 * Stripe's next regular invoice at `seats`. While a schedule manages the
 * subscription, Stripe bills what the schedule says and ignores a quantity
 * passed for the subscription, so the preview has to go through the schedule.
 */
export async function previewRenewalAtSeats(params: {
  seatItemId: string;
  seats: number;
  stripeSubscription: Pick<Stripe.Subscription, "id" | "schedule">;
}): Promise<Stripe.Invoice> {
  if (!params.stripeSubscription.schedule) {
    return await stripeClient.previewSubscriptionRenewalAtQuantity(
      params.stripeSubscription.id,
      params.seatItemId,
      params.seats,
    );
  }

  const scheduleId = resolveStripeId(params.stripeSubscription.schedule);
  const schedule = await stripeClient.retrieveSubscriptionSchedule(scheduleId);
  return await stripeClient.previewSubscriptionScheduleRenewal(
    scheduleId,
    buildPhasesWithRenewalSeats(schedule, params.seats),
  );
}

/**
 * Lowers the Stripe quantity at the next renewal instead of today. Prorating a
 * reduction would return the unused amount to the customer balance while the
 * credits those seats granted stay spendable, so seats could be added for their
 * credits and removed for the money back.
 */
export async function scheduleSeatReduction(
  stripeSubscription: Pick<Stripe.Subscription, "id" | "schedule">,
  seats: number,
): Promise<{ reduction: ScheduledSeatReduction; scheduleId: string }> {
  const existingScheduleId = stripeSubscription.schedule
    ? resolveStripeId(stripeSubscription.schedule)
    : null;
  const schedule = existingScheduleId
    ? await stripeClient.retrieveSubscriptionSchedule(existingScheduleId)
    : await stripeClient.createSubscriptionScheduleFromSubscription(
        stripeSubscription.id,
      );

  if (existingScheduleId && !isSeatReductionSchedule(schedule)) {
    throw badRequest(
      "A plan change is already scheduled for this subscription. Seats can be removed once it has taken effect.",
      { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED },
    );
  }

  try {
    const updated = await stripeClient.updateSubscriptionSchedule(schedule.id, {
      end_behavior: "release",
      metadata: SEAT_REDUCTION_SCHEDULE_METADATA,
      phases: buildPhasesWithRenewalSeats(schedule, seats),
      proration_behavior: "none",
    });

    const reduction = resolveScheduledSeatReduction(updated);
    if (!reduction) {
      throw internalServerError(
        "Unable to schedule organization subscription seats: Stripe did not keep the new phase",
      );
    }
    return { reduction, scheduleId: updated.id };
  } catch (error) {
    // An unmarked schedule would read as somebody else's and block later
    // reductions, so a schedule created above does not outlive this failure.
    if (!existingScheduleId) {
      await stripeClient.releaseSubscriptionSchedule(schedule.id);
    }
    throw error;
  }
}

/** Cancels a pending seat reduction. Other schedules are left alone. */
export async function releaseSeatReduction(
  stripeSubscription: Pick<Stripe.Subscription, "schedule">,
): Promise<boolean> {
  const schedule = await retrieveSeatReductionSchedule(stripeSubscription);
  if (!schedule) {
    return false;
  }

  await stripeClient.releaseSubscriptionSchedule(schedule.id);
  return true;
}

/**
 * Lets go of a seat reduction that has taken effect, so the schedule does not
 * stay attached for another billing period. Stripe's portal cannot update a
 * subscription while a schedule manages it.
 */
export async function releaseAppliedSeatReduction(
  stripeSubscription: Pick<Stripe.Subscription, "schedule">,
): Promise<void> {
  const schedule = await retrieveSeatReductionSchedule(stripeSubscription);
  if (schedule && !resolveScheduledSeatReduction(schedule)) {
    await stripeClient.releaseSubscriptionSchedule(schedule.id);
  }
}

/** Set by cancel_at_period_end (classic billing) or cancel_at (flexible). */
export function isCancellationScheduled(
  subscription: Partial<
    Pick<Stripe.Subscription, "cancel_at" | "cancel_at_period_end">
  >,
): boolean {
  return (
    subscription.cancel_at_period_end === true || subscription.cancel_at != null
  );
}
