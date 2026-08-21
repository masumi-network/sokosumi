import { describe, expect, it } from "vitest";

import {
  refundAdminTaskX402PaymentConflictSchema,
  resolveAdminTaskX402PaymentConflictSchema,
} from "./admin-task-x402-payment.schema";

const envelopeMeta = {
  timestamp: "2026-08-12T10:00:05.000Z",
  requestId: "req_1",
  path: "/v1/admin/task-x402-payments/pay-1/resolve",
  method: "POST",
};

describe("resolveAdminTaskX402PaymentConflictSchema", () => {
  it("keeps retryAfter and retryAfterSeconds on a lease 409", () => {
    const parsed = resolveAdminTaskX402PaymentConflictSchema.parse({
      error: "Conflict",
      message:
        "Another request is signing this x402 payment; its sign lease expires at 2026-08-12T10:00:30.000Z.",
      kind: "sign_in_flight",
      retryAfter: "2026-08-12T10:00:30.000Z",
      retryAfterSeconds: 25,
      meta: envelopeMeta,
    });

    expect(parsed.retryAfter).toBe("2026-08-12T10:00:30.000Z");
    expect(parsed.retryAfterSeconds).toBe(25);
  });

  it("accepts a 409 with no retry fields", () => {
    const parsed = resolveAdminTaskX402PaymentConflictSchema.parse({
      error: "Conflict",
      message: "Task x402 payment has already been compensated",
      kind: "already_resolved",
      meta: envelopeMeta,
    });

    expect(parsed.retryAfter).toBeUndefined();
    expect(parsed.retryAfterSeconds).toBeUndefined();
  });
});

describe("refundAdminTaskX402PaymentConflictSchema", () => {
  it("keeps kind on an already-refunded 409", () => {
    const parsed = refundAdminTaskX402PaymentConflictSchema.parse({
      error: "Conflict",
      message: "Task x402 payment has already been refunded",
      kind: "already_refunded",
      meta: {
        ...envelopeMeta,
        path: "/v1/admin/task-x402-payments/pay-1/refund",
      },
    });

    expect(parsed.kind).toBe("already_refunded");
  });
});
