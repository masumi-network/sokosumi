import { CouponTypeError } from "@/lib/errors/coupon-errors";

import { getCreditsForCoupon } from "../credits";

function createCoupon(params: {
  credits?: string;
  percentOff: number | null;
}): never {
  return {
    metadata: params.credits ? { credits: params.credits } : {},
    percent_off: params.percentOff,
  } as never;
}

describe("getCreditsForCoupon", () => {
  it("returns parsed credits when metadata is a valid multiple of 100", () => {
    const coupon = createCoupon({ credits: "500", percentOff: 100 });
    expect(getCreditsForCoupon(coupon)).toBe(500);
  });

  it("throws when coupon credits are not a multiple of 100", () => {
    const coupon = createCoupon({ credits: "150", percentOff: 100 });
    expect(() => getCreditsForCoupon(coupon)).toThrow(CouponTypeError);
    expect(() => getCreditsForCoupon(coupon)).toThrow(
      "Coupon metadata credits must be a positive integer multiple of 100",
    );
  });

  it("throws when percent_off is missing", () => {
    const coupon = createCoupon({ credits: "500", percentOff: null });
    expect(() => getCreditsForCoupon(coupon)).toThrow(CouponTypeError);
    expect(() => getCreditsForCoupon(coupon)).toThrow(
      "Coupon must have percent_off",
    );
  });
});
