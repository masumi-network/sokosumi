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
  SokoBotBillingAccessError: class SokoBotBillingAccessError extends Error {},
}));
vi.mock("@/services/soko-bot-control-plane.service", () => {
  class SokoBotNoDestinationError extends Error {}
  return {
    SokoBotBusyError: class SokoBotBusyError extends Error {},
    SokoBotDisabledError: class extends Error {},
    SokoBotIdempotencyConflictError: class SokoBotIdempotencyConflictError extends Error {},
    SokoBotNoDestinationError,
    SokoBotNotFoundError: class extends Error {},
    sokoBotControlPlane: { startTurn: mocks.startTurn },
  };
});

import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  SokoBotBusyError,
  SokoBotIdempotencyConflictError,
  SokoBotNoDestinationError,
} from "@/services/soko-bot-control-plane.service";

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

  it("holds the summary for later at the daily cap or without credits, and for the next tick while busy", async () => {
    mocks.findDelegation.mockResolvedValue(null);
    mocks.gate.mockResolvedValue({ ok: false });
    expect(await summarize(null)).toBe("deferred");
    mocks.gate.mockResolvedValue({ ok: true });
    mocks.startTurn.mockRejectedValue(
      new SokoBotBillingAccessError("no credits"),
    );
    expect(await summarize(null)).toBe("deferred");
    mocks.startTurn.mockRejectedValue(new SokoBotBusyError());
    expect(await summarize(null)).toBe("busy");
  });

  it("counts a summary turn that already started as started", async () => {
    mocks.findDelegation.mockResolvedValue(null);
    mocks.startTurn.mockRejectedValue(new SokoBotIdempotencyConflictError());
    expect(await summarize(null)).toBe("started");
  });

  it("hands the moment to the bell when the bot has no 1:1 room", async () => {
    mocks.findDelegation.mockResolvedValue(null);
    mocks.startTurn.mockRejectedValue(new SokoBotNoDestinationError());
    expect(await summarize(null)).toBe("gone");
  });
});
