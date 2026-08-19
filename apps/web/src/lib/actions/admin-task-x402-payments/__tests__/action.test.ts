import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const assertAdminSessionMock = vi.fn();
const refundPaymentMock = vi.fn();
const resolvePaymentMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: (...args: unknown[]) => assertAdminSessionMock(...args),
}));

vi.mock("@/lib/services/admin-task-x402-payment.service", () => ({
  adminTaskX402PaymentService: {
    refundPayment: (...args: unknown[]) => refundPaymentMock(...args),
    resolvePayment: (...args: unknown[]) => resolvePaymentMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import {
  refundTaskX402PaymentAction,
  resolveTaskX402PaymentAction,
} from "../action";

describe("admin task x402 payment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAdminSessionMock.mockReset();
    refundPaymentMock.mockReset();
    resolvePaymentMock.mockReset();
  });

  it("refunds a verified payment and revalidates the dashboard", async () => {
    refundPaymentMock.mockResolvedValue(undefined);

    const result = await refundTaskX402PaymentAction({
      paymentId: "payment_1",
      reason: "agent_output_quality",
    });

    expect(refundPaymentMock).toHaveBeenCalledWith(
      "payment_1",
      "agent_output_quality",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/x402-payments");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("resolves a pending payment and revalidates the dashboard", async () => {
    resolvePaymentMock.mockResolvedValue(undefined);

    const result = await resolveTaskX402PaymentAction({
      paymentId: "payment_2",
      reason: "sign_attempts_exhausted",
    });

    expect(resolvePaymentMock).toHaveBeenCalledWith(
      "payment_2",
      "sign_attempts_exhausted",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/x402-payments");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("rejects non-admin sessions before calling Core", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await refundTaskX402PaymentAction({
      paymentId: "payment_1",
      reason: "support_adjustment",
    });

    expect(refundPaymentMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("returns service failures without revalidating stale data", async () => {
    resolvePaymentMock.mockRejectedValue(new Error("lease still active"));

    const result = await resolveTaskX402PaymentAction({
      paymentId: "payment_2",
      reason: "node_unreachable",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      expect(result.error.message).toBe("lease still active");
    }
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
