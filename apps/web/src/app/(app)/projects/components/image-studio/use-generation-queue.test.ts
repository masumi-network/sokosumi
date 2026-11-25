import { act, render, renderHook, waitFor } from "@testing-library/react";
import {
  Activity,
  createElement,
  startTransition,
  useLayoutEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationQueue, QueuedGeneration } from "./use-generation-queue";
import { useGenerationQueue } from "./use-generation-queue";

const startImageGeneration = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/image-studio/action", () => ({
  startImageGeneration,
}));

/**
 * The rule these tests exist for: asking for four images must buy four
 * images, even though Core will only take a few of them at a time — and a
 * request Core will never accept must not be retried at a wall.
 */

function request(id: string): QueuedGeneration {
  return {
    id,
    projectId: "project-1",
    prompt: `prompt ${id}`,
    modelId: "model-a",
    modelLabel: "Model A",
    settings: { aspectRatio: "1:1", resolution: "1K" },
    parentAssetId: null,
    referenceAssetIds: [],
    idempotencyKey: `ui:${id}`,
  };
}

const accepted = { ok: true, job: { id: "job" } };
const busy = {
  ok: false,
  kind: "image_studio_project_busy",
  message: "This project already has 3 images being generated.",
};
/**
 * Core's existing 422. It comes out of the same transaction that would have
 * written the job row, so nothing was generated and nothing was charged.
 */
const brokeK = {
  ok: false,
  kind: "insufficient_balance",
  message: "Insufficient balance.",
};

beforeEach(() => {
  vi.resetAllMocks();
  startImageGeneration.mockResolvedValue(accepted);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGenerationQueue", () => {
  it("passes the approved headline and lettering mode to Core", async () => {
    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );
    act(() =>
      result.current.enqueue([
        {
          ...request("lettering"),
          modelId: "gemini-pro",
          exportHeadline: "Made to last",
          lettering: "ideogram",
        },
      ]),
    );
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(startImageGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        exportHeadline: "Made to last",
        lettering: "ideogram",
      }),
    );
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("keeps prompt metadata when dispatching a queued request", async () => {
    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );
    act(() => {
      result.current.enqueue([
        {
          ...request("1"),
          templateId: "social-post",
          creativeDirection: "lifestyle",
          variationIndex: 0,
        },
      ]);
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(startImageGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "social-post",
        creativeDirection: "lifestyle",
        variationIndex: 0,
      }),
    );
  });

  it("sends a batch one at a time until the queue is empty", async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useGenerationQueue({ onAccepted }));

    act(() => {
      result.current.enqueue(
        ["1", "2", "3"].map((id) => ({ ...request(id), batchId: "batch-a" })),
      );
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(startImageGeneration).toHaveBeenCalledTimes(3);
    expect(startImageGeneration.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [
        expect.objectContaining({ batchId: "batch-a" }),
      ]),
    );
    expect(onAccepted).toHaveBeenCalledTimes(3);
  });

  it("gives each request its own idempotency key", async () => {
    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1"), request("2")]);
    });
    await waitFor(() => expect(result.current.queued).toHaveLength(0));

    const keys = startImageGeneration.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    // Sharing one key across a batch would make Core answer the second
    // request with the first job, and three of the four images would never
    // exist.
    expect(new Set(keys).size).toBe(2);
  });

  it("holds a request Core is too busy for, and sends it when a slot frees", async () => {
    vi.useFakeTimers();
    startImageGeneration.mockResolvedValueOnce(busy);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueue([request("1")]);
    });

    expect(result.current.waitingForSlot).toBe(true);
    // Still queued, not dropped: this is the difference between a batch of
    // four and a batch of three that nobody was told about.
    expect(result.current.queued).toHaveLength(1);
    expect(result.current.failed).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(result.current.queued).toHaveLength(0);
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
  });

  it("retries a busy request after leaving Studio via Activity hide and returning before the retry timer fires", async () => {
    vi.useFakeTimers();
    startImageGeneration.mockResolvedValueOnce(busy);

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1")]);
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.waitingForSlot).toBe(true);
    expect(latestQueue.queued).toHaveLength(1);

    // Leave Studio before the 4 s retry timer fires.
    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    // The cancelled retry timer must not fire while hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(1);

    // Return to Studio: the queued request should retry and clear waiting state.
    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(2);
    expect(startImageGeneration.mock.calls[1]?.[0]).toEqual(
      startImageGeneration.mock.calls[0]?.[0],
    );
    expect(latestQueue.queued).toHaveLength(0);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
  });

  it("schedules a fresh retry timer if Core is still busy after returning from Activity hide", async () => {
    vi.useFakeTimers();
    startImageGeneration
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(busy);

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1")]);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.waitingForSlot).toBe(true);

    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(2);
    expect(latestQueue.waitingForSlot).toBe(true);
    expect(latestQueue.queued).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(2);
    expect(latestQueue.waitingForSlot).toBe(true);
    expect(latestQueue.queued).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(3);
    expect(latestQueue.queued).toHaveLength(0);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
  });

  it("keeps a generation Core accepted while Studio was hidden under Activity instead of re-sending on reveal", async () => {
    let releaseFirst!: (value: unknown) => void;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1")]);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.queued.map((item) => item.id)).toEqual(["1"]);

    // Hide Studio while the in-flight request is still waiting on Core.
    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    // Core accepts while Studio is hidden; side-effect callback waits for reveal.
    await act(async () => {
      releaseFirst(accepted);
    });
    expect(onAccepted).not.toHaveBeenCalled();

    // Reveal Studio: the accepted item is gone and never sent a second time.
    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.queued).toEqual([]);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
  });

  it("does not invoke onAccepted when Core accepts during the Activity hide window before passive cleanup", async () => {
    let releaseFirst!: (value: unknown) => void;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;
    let onHideCommit: (() => void) | null = null;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      useLayoutEffect(() => {
        return () => {
          onHideCommit?.();
        };
      }, []);
      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previousActEnv = (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT;
    try {
      await act(async () => {
        root.render(
          createElement(Activity, {
            mode: "visible",
            children: createElement(QueueHarness),
          }),
        );
      });

      await act(async () => {
        latestQueue.enqueue([request("1")]);
      });
      expect(startImageGeneration).toHaveBeenCalledTimes(1);

      // Run the Activity hide transition with browser scheduling so passive
      // cleanups defer to a macrotask after commit, then settle Core in that
      // microtask window between the hide commit and passive cleanup.
      const hideCommitted = Promise.withResolvers<void>();
      onHideCommit = () => {
        releaseFirst(accepted);
        hideCommitted.resolve();
      };

      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      startTransition(() => {
        root.render(
          createElement(Activity, {
            mode: "hidden",
            children: createElement(QueueHarness),
          }),
        );
      });
      await hideCommitted.promise;
      await Promise.resolve();
      await Promise.resolve();
      // Let deferred passive cleanups finish before restoring act mode.
      await new Promise((resolve) => setTimeout(resolve, 20));
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnv);
      onHideCommit = null;

      expect(onAccepted).not.toHaveBeenCalled();

      // Returning later flushes the deferred acceptance without re-sending.
      await act(async () => {
        root.render(
          createElement(Activity, {
            mode: "visible",
            children: createElement(QueueHarness),
          }),
        );
      });

      expect(startImageGeneration).toHaveBeenCalledTimes(1);
      expect(latestQueue.queued).toEqual([]);
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
    } finally {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnv);
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("retries immediately on reveal when an in-flight send settles busy between reveal layout and passive setup", async () => {
    let releaseFirst!: (value: unknown) => void;
    startImageGeneration
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(accepted);

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;
    let onRevealLayout: (() => void) | null = null;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      useLayoutEffect(() => {
        onRevealLayout?.();
      }, []);
      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previousActEnv = (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT;
    try {
      await act(async () => {
        root.render(
          createElement(Activity, {
            mode: "visible",
            children: createElement(QueueHarness),
          }),
        );
      });

      await act(async () => {
        latestQueue.enqueue([request("1")]);
      });
      expect(startImageGeneration).toHaveBeenCalledTimes(1);

      await act(async () => {
        root.render(
          createElement(Activity, {
            mode: "hidden",
            children: createElement(QueueHarness),
          }),
        );
      });

      // Settle busy during the reveal layout phase before passive setup runs.
      const revealCommitted = Promise.withResolvers<void>();
      onRevealLayout = () => {
        onRevealLayout = null;
        releaseFirst(busy);
        revealCommitted.resolve();
      };

      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      startTransition(() => {
        root.render(
          createElement(Activity, {
            mode: "visible",
            children: createElement(QueueHarness),
          }),
        );
      });
      await revealCommitted.promise;
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnv);

      // Should retry at once on reveal rather than arming a 4 s timer.
      expect(startImageGeneration).toHaveBeenCalledTimes(2);
      expect(latestQueue.queued).toEqual([]);
      expect(latestQueue.waitingForSlot).toBe(false);
      expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
    } finally {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnv);
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("advances a busy multi-item queue on reveal after Core accepted the head while hidden", async () => {
    vi.useFakeTimers();
    let releaseRetry!: (value: unknown) => void;
    startImageGeneration
      .mockResolvedValueOnce(busy)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRetry = resolve;
          }),
      )
      .mockResolvedValueOnce(accepted);

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1"), request("2")]);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.waitingForSlot).toBe(true);

    // Let the 4 s busy retry fire so item "1" is in flight again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(2);

    // Hide Studio before Core answers the retry.
    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    // Core accepts item "1" while Studio is hidden.
    await act(async () => {
      releaseRetry(accepted);
    });
    expect(onAccepted).not.toHaveBeenCalled();
    // Item "2" must not start while Studio is hidden.
    expect(startImageGeneration).toHaveBeenCalledTimes(2);

    // Reveal Studio: item "1" is not resent; item "2" dispatches and drains.
    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(
      startImageGeneration.mock.calls.map(
        (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
      ),
    ).toEqual(["ui:1", "ui:1", "ui:2"]);
    expect(latestQueue.queued).toEqual([]);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(onAccepted.mock.calls).toEqual([
      [{ remaining: 1 }],
      [{ remaining: 0 }],
    ]);
  });

  it("defers a busy retry until reveal when Core answers busy while Studio is hidden", async () => {
    vi.useFakeTimers();
    let releaseFirst!: (value: unknown) => void;
    startImageGeneration
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(accepted);

    const onAccepted = vi.fn();
    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1")]);
    });

    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    await act(async () => {
      releaseFirst(busy);
    });

    // No retry timer should fire while Studio remains hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(2);
    expect(latestQueue.queued).toEqual([]);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(onAccepted).toHaveBeenCalledWith({ remaining: 0 });
  });

  it("keeps a non-busy rejection that settled while hidden instead of re-sending on reveal", async () => {
    let releaseFirst!: (value: unknown) => void;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );

    let latestQueue!: GenerationQueue;

    function QueueHarness() {
      latestQueue = useGenerationQueue({ onAccepted: vi.fn() });
      return null;
    }

    const { rerender } = render(
      createElement(Activity, {
        mode: "visible",
        children: createElement(QueueHarness),
      }),
    );

    await act(async () => {
      latestQueue.enqueue([request("1")]);
    });

    act(() => {
      rerender(
        createElement(Activity, {
          mode: "hidden",
          children: createElement(QueueHarness),
        }),
      );
    });

    await act(async () => {
      releaseFirst({
        ok: false,
        kind: "image_studio_unsupported_model_settings",
        message: "That model cannot produce 9:16.",
      });
    });

    await act(async () => {
      rerender(
        createElement(Activity, {
          mode: "visible",
          children: createElement(QueueHarness),
        }),
      );
    });

    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(latestQueue.queued).toEqual([]);
    expect(latestQueue.waitingForSlot).toBe(false);
    expect(latestQueue.failed[0]?.message).toBe(
      "That model cannot produce 9:16.",
    );
  });

  it("does not invoke onAccepted or schedule a retry timer if a request settles after unmount", async () => {
    vi.useFakeTimers();
    let releaseAccepted!: (value: unknown) => void;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAccepted = resolve;
        }),
    );

    const onAccepted = vi.fn();
    const first = renderHook(() => useGenerationQueue({ onAccepted }));
    await act(async () => {
      first.result.current.enqueue([request("1")]);
    });

    first.unmount();
    await act(async () => {
      releaseAccepted(accepted);
    });
    expect(onAccepted).not.toHaveBeenCalled();

    let releaseBusy!: (value: unknown) => void;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBusy = resolve;
        }),
    );

    const second = renderHook(() => useGenerationQueue({ onAccepted }));
    await act(async () => {
      second.result.current.enqueue([request("2")]);
    });

    second.unmount();
    await act(async () => {
      releaseBusy(busy);
    });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
  });

  it("saves a rejected request without automatically retrying it", async () => {
    startImageGeneration.mockResolvedValue({
      ok: false,
      kind: "image_studio_unsupported_model_settings",
      message: "That model cannot produce 9:16.",
    });

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1")]);
    });

    await waitFor(() =>
      expect(result.current.failed[0]?.message).toBe(
        "That model cannot produce 9:16.",
      ),
    );
    expect(result.current.queued).toHaveLength(0);
    // Retrying a rejection is how a queue turns into a loop against Core.
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(result.current.waitingForSlot).toBe(false);
  });

  it("saves a transport failure for manual same-key retry", async () => {
    startImageGeneration.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1")]);
    });

    // A code rather than a sentence, so the page can say it in the reader's
    // language; Core never answered, so there is no message of its own to show.
    await waitFor(() =>
      expect(result.current.failed[0]?.code).toBe("unreachable"),
    );
    expect(result.current.failed[0]?.message).toBeNull();
    expect(result.current.queued).toHaveLength(0);
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("can drop a request that has not been sent yet", async () => {
    vi.useFakeTimers();
    startImageGeneration.mockResolvedValue(busy);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueue([request("1"), request("2")]);
    });
    expect(result.current.waitingForSlot).toBe(true);

    act(() => {
      result.current.remove("2");
    });
    expect(result.current.queued.map((item) => item.id)).toEqual(["1"]);
  });
});

describe("not enough credits", () => {
  it("holds the whole remaining batch, rather than submitting it against the same wall", async () => {
    startImageGeneration.mockResolvedValue(brokeK);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1"), request("2"), request("3")]);
    });

    await waitFor(() =>
      expect(result.current.failed[0]?.code).toBe("insufficient_credits"),
    );
    // One attempt, and the other two are gone. Sending them would hit the same
    // wall and say so three times over.
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(result.current.queued).toHaveLength(0);
    expect(result.current.waitingForSlot).toBe(false);
    // A code, so the page can say "not enough credits" in the reader's
    // language rather than forwarding Core's English sentence.
    expect(result.current.failed[0]?.message).toBeNull();
  });

  it("clears on the next attempt, so a top-up can be tried straight away", async () => {
    startImageGeneration.mockResolvedValue(brokeK);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1")]);
    });
    await waitFor(() =>
      expect(result.current.failed[0]?.code).toBe("insufficient_credits"),
    );

    startImageGeneration.mockResolvedValue(accepted);
    act(() => {
      result.current.retry("1");
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(result.current.failed).toEqual([]);
  });
});
