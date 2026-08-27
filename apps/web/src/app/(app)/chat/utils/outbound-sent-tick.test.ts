import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearOutboundSentTicksForTests,
  isOutboundSentTickActive,
  markOutboundSentTick,
} from "./outbound-sent-tick";

describe("outbound-sent-tick registry", () => {
  afterEach(() => {
    clearOutboundSentTicksForTests();
    vi.useRealTimers();
  });

  it("is active until the duration elapses, then drops the key", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-01T12:00:00.000Z");
    vi.setSystemTime(now);

    markOutboundSentTick("msg-1", 1000);
    expect(isOutboundSentTickActive("msg-1")).toBe(true);

    vi.setSystemTime(new Date(now.getTime() + 1001));
    expect(isOutboundSentTickActive("msg-1")).toBe(false);
    // Second read still false (expired key deleted on first check).
    expect(isOutboundSentTickActive("msg-1")).toBe(false);
  });

  it("accepts message id or client turn id", () => {
    markOutboundSentTick(["srv-1", "turn-1"], 60_000);
    expect(isOutboundSentTickActive("srv-1")).toBe(true);
    expect(isOutboundSentTickActive("turn-1")).toBe(true);
    expect(isOutboundSentTickActive("other")).toBe(false);
  });

  it("sweeps unread expired keys on the next mark", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-01T12:00:00.000Z");
    vi.setSystemTime(now);
    markOutboundSentTick("stale", 1000);

    vi.setSystemTime(new Date(now.getTime() + 1001));
    markOutboundSentTick("fresh", 60_000);

    expect(isOutboundSentTickActive("stale")).toBe(false);
    expect(isOutboundSentTickActive("fresh")).toBe(true);
  });
});
