import { Stripe } from "stripe";

import { CouponTypeError } from "@/lib/errors/coupon-errors";

export function getCreditsForCoupon(coupon: Stripe.Coupon): number {
  if (!coupon.percent_off) {
    throw new CouponTypeError("Coupon must have percent_off");
  }
  const creditsRaw = coupon.metadata?.credits;
  if (creditsRaw == null || creditsRaw === "") {
    throw new CouponTypeError(
      "Coupon metadata must include credits as a positive integer",
    );
  }
  const credits = parseInt(creditsRaw, 10);
  if (Number.isNaN(credits) || credits < 1) {
    throw new CouponTypeError(
      "Coupon metadata must include credits as a positive integer",
    );
  }
  return credits;
}
