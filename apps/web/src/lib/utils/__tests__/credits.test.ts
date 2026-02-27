import { CouponTypeError } from "@/lib/errors/coupon-errors";

import {
  formatCreditsForDisplay,
  getCouponTtlDays,
  getCreditsForCoupon,
} from "../credits";

function createCoupon(params: {
  credits?: string;
  ttlDays?: string;
  percentOff: number | null;
}): never {
  return {
    metadata: {
      ...(params.credits ? { credits: params.credits } : {}),
      ...(params.ttlDays ? { ttl_days: params.ttlDays } : {}),
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

describe("getCouponTtlDays", () => {
  it("returns normalized ttl_days for positive integer values", () => {
    const coupon = createCoupon({
      credits: "500",
      ttlDays: "90",
      percentOff: 100,
    });
    expect(getCouponTtlDays(coupon)).toBe("90");
  });

  it("returns 0 for zero ttl_days", () => {
    const coupon = createCoupon({
      credits: "500",
      ttlDays: "0",
      percentOff: 100,
    });
    expect(getCouponTtlDays(coupon)).toBe("0");
  });

  it("returns null for string null ttl_days", () => {
    const coupon = createCoupon({
      credits: "500",
      ttlDays: "null",
      percentOff: 100,
    });
    expect(getCouponTtlDays(coupon)).toBeNull();
  });

  it("returns null for invalid ttl_days values", () => {
    const negative = createCoupon({
      credits: "500",
      ttlDays: "-1",
      percentOff: 100,
    });
    const decimal = createCoupon({
      credits: "500",
      ttlDays: "1.5",
      percentOff: 100,
    });
    const nonNumeric = createCoupon({
      credits: "500",
      ttlDays: "abc",
      percentOff: 100,
    });
    expect(getCouponTtlDays(negative)).toBeNull();
    expect(getCouponTtlDays(decimal)).toBeNull();
    expect(getCouponTtlDays(nonNumeric)).toBeNull();
  });
});
