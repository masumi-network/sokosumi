import { isPositiveIntegerCredits } from "@sokosumi/utils";
import { CouponTypeError } from "@/lib/errors/coupon-errors";

interface CouponCreditsMetadata {
  metadata?: {
    credits?: string;
  } | null;
  percent_off?: number | null;
}

export function getCreditsForCoupon(coupon: CouponCreditsMetadata): number {
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

/**
 * Formats credits for user-facing display by removing decimal precision.
 */
export function formatCreditsForDisplay(credits: number): number {
  return Math.trunc(credits);
}
