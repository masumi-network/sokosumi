import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedGeneration } from "./use-generation-queue";
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
  vi.clearAllMocks();
  startImageGeneration.mockResolvedValue(accepted);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGenerationQueue", () => {
  it("sends a batch one at a time until the queue is empty", async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useGenerationQueue({ onAccepted }));

    act(() => {
      result.current.enqueue([request("1"), request("2"), request("3")]);
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(startImageGeneration).toHaveBeenCalledTimes(3);
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

    act(() => {
      result.current.enqueue([request("1")]);
    });

    await vi.waitFor(() => expect(result.current.waitingForSlot).toBe(true));
    // Still queued, not dropped: this is the difference between a batch of
    // four and a batch of three that nobody was told about.
    expect(result.current.queued).toHaveLength(1);
    expect(result.current.lastError).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await vi.waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
  });

  it("drops a request that will never work, and says why", async () => {
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
      expect(result.current.lastError).toBe("That model cannot produce 9:16."),
    );
    expect(result.current.queued).toHaveLength(0);
    // Retrying a rejection is how a queue turns into a loop against Core.
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(result.current.waitingForSlot).toBe(false);
  });

  it("treats a transport failure as permanent for that request", async () => {
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
      expect(result.current.lastErrorCode).toBe("unreachable"),
    );
    expect(result.current.lastError).toBeNull();
    expect(result.current.queued).toHaveLength(0);
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("can drop a request that has not been sent yet", async () => {
    vi.useFakeTimers();
    startImageGeneration.mockResolvedValue(busy);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1"), request("2")]);
    });
    await vi.waitFor(() => expect(result.current.waitingForSlot).toBe(true));

    act(() => {
      result.current.remove("2");
    });
    expect(result.current.queued.map((item) => item.id)).toEqual(["1"]);
  });
});

describe("not enough credits", () => {
  it("drops the whole batch, not just the request that hit the wall", async () => {
    startImageGeneration.mockResolvedValue(brokeK);

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );

    act(() => {
      result.current.enqueue([request("1"), request("2"), request("3")]);
    });

    await waitFor(() =>
      expect(result.current.lastErrorCode).toBe("insufficient_credits"),
    );
    // One attempt, and the other two are gone. Sending them would hit the same
    // wall and say so three times over.
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
    expect(result.current.queued).toHaveLength(0);
    expect(result.current.waitingForSlot).toBe(false);
    // A code, so the page can say "not enough credits" in the reader's
    // language rather than forwarding Core's English sentence.
    expect(result.current.lastError).toBeNull();
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
      expect(result.current.lastErrorCode).toBe("insufficient_credits"),
    );

    startImageGeneration.mockResolvedValue(accepted);
    act(() => {
      result.current.enqueue([request("2")]);
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(result.current.lastErrorCode).toBeNull();
  });
});
