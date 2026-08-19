import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/clients/core.client", () => ({ coreClient: {} }));

import { turnStatusSnapshot } from "../soko-bot.service";

describe("turnStatusSnapshot", () => {
  it("changes when status, answer, events or decisions change", () => {
    const base = {
      id: "t1",
      status: "RUNNING",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      events: [{ id: "e1" }],
      delegations: [],
      pendingDecisions: [],
      finalAnswer: null,
    } as never;
    const a = turnStatusSnapshot(base).fingerprint;
    const b = turnStatusSnapshot({
      ...(base as object),
      events: [{ id: "e1" }, { id: "e2" }],
    } as never).fingerprint;
    const c = turnStatusSnapshot({
      ...(base as object),
      status: "COMPLETED",
      finalAnswer: "done",
    } as never).fingerprint;
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(turnStatusSnapshot(base).fingerprint).toBe(a);
  });
});
