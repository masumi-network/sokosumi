import { MemberRole } from "@sokosumi/database";
import {
  assertOrganizationSubscriptionChangeAllowed,
  OrganizationSubscriptionExclusivityError,
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
      "An active organization subscription is required before updating seats.",
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
      "Unable to update organization subscription seats: missing Stripe subscription item",
    );
  }

  return { seatItem, stripeSubscription };
}

/** A pending seat reduction, read from its Stripe subscription schedule. */
export interface ScheduledSeatReduction {
  scheduledSeats: number;
  scheduledSeatsAt: Date;
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

function resolveStripeScheduleId(
  stripeSubscription: Pick<Stripe.Subscription, "schedule">,
) {
  return typeof stripeSubscription.schedule === "string"
    ? stripeSubscription.schedule
    : (stripeSubscription.schedule?.id ?? null);
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
  const scheduledSeats = schedule.phases.at(-1)?.items[0]?.quantity;
  if (
    !currentPhaseEnd ||
    !scheduledSeats ||
    schedule.phases.at(-1)?.start_date !== currentPhaseEnd
  ) {
    return null;
  }

  return {
    scheduledSeats,
    scheduledSeatsAt: new Date(currentPhaseEnd * 1000),
  };
}

function buildSeatReductionPhaseSettings(
  phase: Stripe.SubscriptionSchedule.Phase,
) {
  return {
    automatic_tax: { enabled: true },
    // Omitting a setting here clears it, so a discount has to be carried over.
    discounts: phase.discounts.map(({ coupon, discount, promotion_code }) => {
      if (discount) {
        return {
          discount: typeof discount === "string" ? discount : discount.id,
        };
      }
      if (promotion_code) {
        return {
          promotion_code:
            typeof promotion_code === "string"
              ? promotion_code
              : promotion_code.id,
        };
      }
      return {
        coupon: typeof coupon === "string" ? coupon : coupon?.id,
      };
    }),
    proration_behavior: "none" as const,
  };
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
): Promise<ScheduledSeatReduction & { scheduleId: string }> {
  const existingScheduleId = resolveStripeScheduleId(stripeSubscription);
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

  // A schedule keeps its finished phases, so find the running one by its start.
  const currentPhase = schedule.phases.find(
    (phase) => phase.start_date === schedule.current_phase?.start_date,
  );
  if (!currentPhase) {
    throw internalServerError(
      "Unable to schedule organization subscription seats: Stripe schedule has no current phase",
    );
  }

  const prices = currentPhase.items.map(({ price, quantity }) => ({
    price: typeof price === "string" ? price : price.id,
    quantity,
  }));
  const settings = buildSeatReductionPhaseSettings(currentPhase);

  try {
    const updated = await stripeClient.updateSubscriptionSchedule(schedule.id, {
      end_behavior: "release",
      metadata: SEAT_REDUCTION_SCHEDULE_METADATA,
      phases: [
        {
          ...settings,
          end_date: currentPhase.end_date,
          items: prices,
          start_date: currentPhase.start_date,
        },
        {
          ...settings,
          items: prices.map(({ price }) => ({ price, quantity: seats })),
        },
      ],
      proration_behavior: "none",
    });

    const reduction = resolveScheduledSeatReduction(updated);
    if (!reduction) {
      throw internalServerError(
        "Unable to schedule organization subscription seats: Stripe did not keep the new phase",
      );
    }
    return { ...reduction, scheduleId: updated.id };
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
  const scheduleId = resolveStripeScheduleId(stripeSubscription);
  if (!scheduleId) {
    return false;
  }

  const schedule = await stripeClient.retrieveSubscriptionSchedule(scheduleId);
  if (schedule.status !== "active" || !isSeatReductionSchedule(schedule)) {
    return false;
  }

  await stripeClient.releaseSubscriptionSchedule(scheduleId);
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
  const scheduleId = resolveStripeScheduleId(stripeSubscription);
  if (!scheduleId) {
    return;
  }

  const schedule = await stripeClient.retrieveSubscriptionSchedule(scheduleId);
  if (
    schedule.status === "active" &&
    isSeatReductionSchedule(schedule) &&
    !resolveScheduledSeatReduction(schedule)
  ) {
    await stripeClient.releaseSubscriptionSchedule(scheduleId);
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
