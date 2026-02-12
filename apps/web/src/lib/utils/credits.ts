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
