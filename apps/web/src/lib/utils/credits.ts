import { Stripe } from "stripe";

import { CouponTypeError } from "@/lib/errors/coupon-errors";
import { isStripeUnitAlignedCredits } from "@/lib/stripe/credit-topup-pricing";

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
  if (!isStripeUnitAlignedCredits(credits)) {
    throw new CouponTypeError(
      "Coupon metadata credits must be a positive integer multiple of 100",
    );
  }
  return credits;
}
