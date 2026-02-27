import { Stripe } from "stripe";

import { CouponTypeError } from "@/lib/errors/coupon-errors";
import { isPositiveIntegerCredits } from "@/lib/stripe/credit-topup-pricing";

export function getCreditsForCoupon(coupon: Stripe.Coupon): number {
  if (!coupon.percent_off) {
    throw new CouponTypeError("Coupon must have percent_off");
  }

  const creditsRaw = coupon.metadata?.credits;
  if (!creditsRaw) {
    throw new CouponTypeError(
      "Coupon metadata must include credits as a positive integer",
    );
  }

  const credits = Number(creditsRaw);
  if (!isPositiveIntegerCredits(credits)) {
    throw new CouponTypeError(
      "Coupon metadata credits must be a positive integer",
    );
  }
  return credits;
}

export function getCouponTtlDays(coupon: Stripe.Coupon): string | null {
  const ttlDaysRaw = coupon.metadata?.ttl_days;
  if (ttlDaysRaw === undefined) {
    return null;
  }

  const normalizedTtlDays = ttlDaysRaw.trim();
  if (!normalizedTtlDays) {
    return null;
  }

  if (normalizedTtlDays.toLowerCase() === "null") {
    return "null";
  }

  const ttlDays = Number(normalizedTtlDays);
  if (!Number.isInteger(ttlDays) || ttlDays < 0) {
    return null;
  }

  return String(ttlDays);
}

/**
 * Formats credits for user-facing display by removing decimal precision.
 */
export function formatCreditsForDisplay(credits: number): number {
  return Math.trunc(credits);
}
