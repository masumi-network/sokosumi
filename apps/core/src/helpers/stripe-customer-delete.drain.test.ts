import { describe, expect, it, vi } from "vitest";

import { coreLogEvents, expectCoreLog } from "@/test/core-log";

// The real `captureExternalServiceError`, unlike the sibling test: what the
// drain sees of a Stripe failure is the subject here.
const { deleteCustomerMock } = vi.hoisted(() => ({
  deleteCustomerMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  withScope: vi.fn(),
}));
vi.mock("@/clients/stripe.client", () => ({
  stripeClient: { deleteCustomer: deleteCustomerMock },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    subscription: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { deleteStripeCustomerBestEffort } from "./stripe-customer-delete";

describe("a failed Stripe customer delete in the drain", () => {
  it("keeps the response's message out, and its status", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Kept a transient external failure out of Sentry",
    );
    // The Stripe SDK copies the response's error.message, from Stripe or a
    // proxy in front of it, into the error it throws.
    deleteCustomerMock.mockRejectedValue(
      Object.assign(
        new Error(
          "Bad gateway: upstream echoed PRIVATE-MARKER-4d2 with tok_live_k29s",
        ),
        { type: "StripeAPIError", statusCode: 502 },
      ),
    );

    await deleteStripeCustomerBestEffort({
      stripeCustomerId: "cus_1",
      ownerType: "user",
      ownerId: "user_1",
    });

    expect(warnings[0]?.cause).toBeUndefined();
    expect(warnings[0]?.event).toMatchObject({
      suppressedFailure: { label: "stripe_customer_delete" },
      failure: { errorName: "Error", status: 502 },
      stripeCustomerId: "cus_1",
    });
    const drained = JSON.stringify(coreLogEvents());
    expect(drained).not.toContain("PRIVATE-MARKER");
    expect(drained).not.toContain("tok_live_k29s");
  });
});
