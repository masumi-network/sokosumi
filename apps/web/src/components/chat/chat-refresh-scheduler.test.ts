// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

import {
  CHAT_HEALTHY_REFRESH_MS,
  createChatRefreshScheduler,
} from "./chat-refresh-scheduler";

const FALLBACK_MS = 3_000;

let visibility: ReturnType<typeof vi.spyOn>;
let hasFocus: ReturnType<typeof vi.spyOn>;

describe("createChatRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    resetChatReadThrottleForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetChatReadThrottleForTests();
  });

  it("starts on cadence, runs explicit requests, and stops cleanly without React", async () => {
    let seenCurrent: boolean | null = null;
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn<(isCurrent: () => boolean) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async (isCurrent) => {
        await pending.promise;
        seenCurrent = isCurrent();
      });

    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: true,
      fallbackIntervalMs: FALLBACK_MS,
    });

    // Stopped before start(): explicit requests are no-ops.
    scheduler.request();
    expect(refresh).not.toHaveBeenCalled();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.request();
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.stop();
    pending.resolve();
    await Promise.resolve();
    expect(seenCurrent).toBe(false);

    // Stopped: timers, listeners, and explicit requests stay quiet.
    scheduler.request();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("resets in-flight, queued, and needed state on stop and start", async () => {
    const firstPending = Promise.withResolvers<void>();
    const refresh = vi
      .fn<(isCurrent: () => boolean) => Promise<void>>()
      .mockReturnValueOnce(firstPending.promise)
      .mockResolvedValue(undefined);

    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: false,
      fallbackIntervalMs: FALLBACK_MS,
    });

    scheduler.start();
    scheduler.request();
    scheduler.request(); // queued on the first run
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.stop();
    scheduler.start();

    firstPending.resolve();
    await Promise.resolve();
    // Completing the stopped run must not drain its queued follow-up.
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("keeps hadHealthy and wasHealthy across a stop and start restart", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: true,
      fallbackIntervalMs: FALLBACK_MS,
      refreshOnRecovery: true,
    });

    scheduler.start();
    scheduler.setHealth(false);
    expect(refresh).not.toHaveBeenCalled();

    scheduler.stop();
    scheduler.start();

    scheduler.setHealth(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("updates hadHealthy and wasHealthy while stopped without running a request", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: false,
      fallbackIntervalMs: FALLBACK_MS,
      refreshOnRecovery: true,
    });

    // Health becomes true, drops, and recovers while stopped: no read runs,
    // yet hadHealthy is remembered for later starts.
    scheduler.setHealth(true);
    scheduler.setHealth(false);
    scheduler.setHealth(true);
    expect(refresh).not.toHaveBeenCalled();

    scheduler.setHealth(false);
    scheduler.start();
    scheduler.setHealth(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("runs a mount read while backgrounded and does not re-arm while in flight", async () => {
    visibility.mockReturnValue("hidden");
    hasFocus.mockReturnValue(false);
    const pending = Promise.withResolvers<void>();
    const refresh = vi
      .fn<(isCurrent: () => boolean) => Promise<void>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);

    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: false,
      fallbackIntervalMs: FALLBACK_MS,
      refreshOnMount: true,
    });

    scheduler.start();
    scheduler.setHealth(false);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);

    pending.resolve();
    await Promise.resolve();
    scheduler.stop();
  });

  it("stops cleanly when stop() is called synchronously inside the mount refresh", async () => {
    let seenCurrent: boolean | null = null;
    const refresh = vi.fn(async (isCurrent: () => boolean) => {
      scheduler.stop();
      seenCurrent = isCurrent();
    });
    const scheduler = createChatRefreshScheduler({
      refresh,
      healthy: false,
      fallbackIntervalMs: FALLBACK_MS,
      refreshOnMount: true,
    });

    scheduler.start();
    await Promise.resolve();
    expect(seenCurrent).toBe(false);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("aborts the refresh signal when stopped mid-flight", async () => {
    const pending = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    const scheduler = createChatRefreshScheduler({
      refresh: async (_isCurrent, signal) => {
        receivedSignal = signal;
        await pending.promise;
      },
      healthy: true,
      fallbackIntervalMs: FALLBACK_MS,
      refreshOnMount: true,
    });

    scheduler.start();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);

    scheduler.stop();
    expect(receivedSignal?.aborted).toBe(true);

    pending.resolve();
    await Promise.resolve();
  });
});
