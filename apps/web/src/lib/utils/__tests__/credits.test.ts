import { CouponTypeError } from "@/lib/errors/coupon-errors";

import { formatCreditsForDisplay, getCreditsForCoupon } from "../credits";

function createCoupon(params: {
  credits?: string;
  percentOff: number | null;
}): never {
  return {
    metadata: {
      ...(params.credits ? { credits: params.credits } : {}),
    },
    percent_off: params.percentOff,
  } as never;
}

describe("getCreditsForCoupon", () => {
  it("returns parsed credits when metadata is a positive integer", () => {
    const coupon = createCoupon({ credits: "150", percentOff: 100 });
    expect(getCreditsForCoupon(coupon)).toBe(150);
  });

  it("throws when coupon credits are not a positive integer", () => {
    const coupon = createCoupon({ credits: "1.5", percentOff: 100 });
    expect(() => getCreditsForCoupon(coupon)).toThrow(CouponTypeError);
    expect(() => getCreditsForCoupon(coupon)).toThrow(
      "Coupon metadata credits must be a positive integer",
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

describe("formatCreditsForDisplay", () => {
  it("truncates decimal values", () => {
    expect(formatCreditsForDisplay(2.4)).toBe(2);
    expect(formatCreditsForDisplay(2.5)).toBe(2);
    expect(formatCreditsForDisplay(2.9)).toBe(2);
  });
});
