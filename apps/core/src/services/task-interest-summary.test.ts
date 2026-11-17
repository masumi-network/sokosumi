import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDelegation: vi.fn(),
  gate: vi.fn(),
  startTurn: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotDelegation: { findFirst: mocks.findDelegation } },
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: mocks.gate,
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  SokoBotBillingAccessError: class extends Error {},
}));
vi.mock("@/services/soko-bot-control-plane.service", () => {
  class SokoBotNoDestinationError extends Error {}
  return {
    SokoBotBusyError: class extends Error {},
    SokoBotDisabledError: class extends Error {},
    SokoBotIdempotencyConflictError: class extends Error {},
    SokoBotNoDestinationError,
    SokoBotNotFoundError: class extends Error {},
    sokoBotControlPlane: { startTurn: mocks.startTurn },
  };
});

import { SokoBotNoDestinationError } from "@/services/soko-bot-control-plane.service";

import { startTaskSummaryTurn } from "./task-interest-summary";

const summarize = (completedBySokoBotId: string | null) =>
  startTaskSummaryTurn({
    momentKey: "status:event-1",
    task: { id: "task-1", workspaceId: "workspace-1", identifier: "SOK-1" },
    userId: "user-1",
    sokoBotId: "bot-1",
    completedBySokoBotId,
    abortSignal: new AbortController().signal,
  });

describe("startTaskSummaryTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gate.mockResolvedValue({ ok: true });
    mocks.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "COMPLETED",
      reconciliationLeaseToken: null,
    });
  });

  it("leaves the report to the delegation wake when another hand completed the Task", async () => {
    mocks.findDelegation.mockResolvedValue({ id: "delegation-1" });
    expect(await summarize(null)).toBe("covered");
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  it("writes the summary when the bot completed the Task itself, which wakes nothing", async () => {
    mocks.findDelegation.mockResolvedValue({ id: "delegation-1" });
    expect(await summarize("bot-1")).toBe("started");
    expect(mocks.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: "task-interest:status:event-1",
        source: "EVENT",
      }),
    );
  });

  it("hands the moment to the bell when its summary turn already failed", async () => {
    mocks.findDelegation.mockResolvedValue(null);
    mocks.startTurn.mockResolvedValue({
      turnId: "turn-1",
      status: "FAILED",
      reconciliationLeaseToken: null,
    });
    expect(await summarize(null)).toBe("gone");
  });

  it("hands the moment to the bell when the bot has no 1:1 room", async () => {
    mocks.findDelegation.mockResolvedValue(null);
    mocks.startTurn.mockRejectedValue(new SokoBotNoDestinationError());
    expect(await summarize(null)).toBe("gone");
  });
});
