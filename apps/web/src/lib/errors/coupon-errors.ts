export class CouponError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "CouponError";
  }
}
