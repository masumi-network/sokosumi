export class CouponError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "CouponError";
  }
}

export class CouponNotFoundError extends CouponError {
  constructor(couponId: string) {
    super(`Coupon ${couponId} not found`, "COUPON_NOT_FOUND");
  }
}

export class CouponTypeError extends CouponError {
  constructor(message: string) {
    super(message, "COUPON_TYPE_ERROR");
  }
}

export class CouponCurrencyError extends CouponError {
  constructor(currency: string, expectedCurrency?: string) {
    const message = expectedCurrency
      ? `Coupon currency ${currency} does not match expected currency ${expectedCurrency}`
      : `Coupon currency ${currency} is not supported`;
    super(message, "COUPON_CURRENCY_ERROR");
  }
}
