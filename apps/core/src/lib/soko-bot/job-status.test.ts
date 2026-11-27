import { describe, expect, it } from "vitest";
import { sokoBotJobStatus } from "./job-status";

const NOW = new Date();
const awaitingInput = (input: { id: string } | null) => ({
  status: "AWAITING_INPUT" as const,
  input,
  inputSchema: '{"input_data":[]}',
  createdAt: NOW,
});

function job(overrides: Record<string, unknown>) {
  return {
    projectId: null,
    jobType: "PAID" as const,
    refundedTransactionId: null,
    createdAt: NOW,
    payByTime: null,
    submitResultTime: null,
    externalDisputeUnlockTime: null,
    purchase: null,
    events: [awaitingInput(null)],
    ...overrides,
  } as unknown as Parameters<typeof sokoBotJobStatus>[0];
}

const purchase = (onChainStatus: string) => ({
  onChainStatus,
  nextAction: "NONE",
});

describe("sokoBotJobStatus", () => {
  it("asks for input only while input is required", () => {
    expect(
      sokoBotJobStatus(job({ purchase: purchase("FUNDS_LOCKED") })),
    ).toEqual({ status: "input_required", inputSchema: '{"input_data":[]}' });
  });

  it("never asks for input on a refunded Job", () => {
    expect(
      sokoBotJobStatus(job({ purchase: purchase("REFUND_WITHDRAWN") })),
    ).toEqual({ status: "refund_resolved", inputSchema: null });
  });

  it("never asks for input when the payment failed", () => {
    expect(
      sokoBotJobStatus(job({ payByTime: new Date(Date.now() - 86_400_000) })),
    ).toEqual({ status: "payment_failed", inputSchema: null });
  });

  it("never asks again for input already given on a free Job", () => {
    expect(
      sokoBotJobStatus(
        job({ jobType: "FREE", events: [awaitingInput({ id: "input-1" })] }),
      ),
    ).toEqual({ status: "processing", inputSchema: null });
  });
});
