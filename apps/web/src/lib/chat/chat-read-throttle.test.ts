import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_READ_THROTTLE_FALLBACK_SECONDS,
  chatReadThrottleResumeInMs,
  noteChatReadThrottled,
  parseRetryDelaySeconds,
  resetChatReadThrottleForTests,
} from "./chat-read-throttle";

describe("parseRetryDelaySeconds", () => {
  it.each([
    ["7", 7],
    [7, 7],
    [" 12 ", 12],
  ])("parses %p as %i seconds", (value, expected) => {
    expect(parseRetryDelaySeconds(value)).toBe(expected);
  });

  it("rounds a fractional delay up, never down", () => {
    expect(parseRetryDelaySeconds(2.5)).toBe(3);
  });

  it.each([
    ["soon"],
    [""],
    ["0"],
    ["-3"],
    [0],
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [null],
    [undefined],
    [{}],
    [true],
  ])("treats %p as no usable delay", (value) => {
    expect(parseRetryDelaySeconds(value)).toBeUndefined();
  });
});

describe("chat read throttle clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    resetChatReadThrottleForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetChatReadThrottleForTests();
  });

  it("is clear when nothing throttled it", () => {
    expect(chatReadThrottleResumeInMs()).toBe(0);
  });

  it("asks for the full delay right after arming", () => {
    noteChatReadThrottled(30);
    expect(chatReadThrottleResumeInMs()).toBe(30_000);
  });

  it("counts down while the window elapses", async () => {
    noteChatReadThrottled(30);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chatReadThrottleResumeInMs()).toBe(20_000);
  });

  it("clears once the window ends", async () => {
    noteChatReadThrottled(30);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(chatReadThrottleResumeInMs()).toBe(0);
  });

  it("extends to the later deadline, never shortens", () => {
    noteChatReadThrottled(30);
    noteChatReadThrottled(5);
    expect(chatReadThrottleResumeInMs()).toBe(30_000);
  });

  it("extends the window when throttled again with a longer delay", async () => {
    noteChatReadThrottled(10);
    await vi.advanceTimersByTimeAsync(8_000);
    noteChatReadThrottled(30);
    expect(chatReadThrottleResumeInMs()).toBe(30_000);
  });

  it("honors a huge delay as asked, without capping it", () => {
    noteChatReadThrottled(3_600);
    expect(chatReadThrottleResumeInMs()).toBe(3_600_000);
  });

  it("falls back to a short bounded wait without a delay", () => {
    noteChatReadThrottled();
    expect(chatReadThrottleResumeInMs()).toBe(
      CHAT_READ_THROTTLE_FALLBACK_SECONDS * 1000,
    );
  });

  it("pins the fallback to seconds: never zero, never minutes", () => {
    expect(CHAT_READ_THROTTLE_FALLBACK_SECONDS).toBeGreaterThan(0);
    expect(CHAT_READ_THROTTLE_FALLBACK_SECONDS).toBeLessThan(60);
  });

  it("spreads the resume by up to a quarter, never below the delay", () => {
    noteChatReadThrottled(10);
    expect(chatReadThrottleResumeInMs()).toBe(10_000);

    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(chatReadThrottleResumeInMs()).toBe(12_500);
  });
});
