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
