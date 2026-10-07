import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedGeneration } from "./use-generation-queue";
import { useGenerationQueue } from "./use-generation-queue";

/**
 * The findings an external review raised on the v2 diff, as regressions.
 */

const startImageGeneration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/image-studio/action", () => ({ startImageGeneration }));

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

beforeEach(() => {
  vi.clearAllMocks();
  startImageGeneration.mockResolvedValue({ ok: true, job: { id: "job" } });
});

describe("the queue dispatcher", () => {
  it("does not re-send the head when the accepted callback changes identity", async () => {
    // `onAccepted` is the page's refresh, whose identity changes on every
    // arrow key. As a dependency it used to tear down the in-flight send and
    // immediately start the same one again.
    let release: ((v: unknown) => void) | undefined;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );

    const { rerender, result } = renderHook(
      ({ cb }: { cb: () => void }) => useGenerationQueue({ onAccepted: cb }),
      { initialProps: { cb: () => {} } },
    );

    act(() => result.current.enqueue([request("1")]));
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(1));

    // A brand-new callback identity, exactly as a search-param change causes.
    rerender({ cb: () => {} });
    rerender({ cb: () => {} });
    await new Promise((r) => setTimeout(r, 50));

    expect(startImageGeneration).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.({ ok: true, job: { id: "job" } });
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
  });

  it("does not re-send the head when another request is enqueued mid-flight", async () => {
    let release: ((v: unknown) => void) | undefined;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );

    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: () => {} }),
    );

    act(() => result.current.enqueue([request("1")]));
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(1));

    act(() => result.current.enqueue([request("2")]));
    await new Promise((r) => setTimeout(r, 50));
    // Still one call: the head is already in flight.
    expect(startImageGeneration).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.({ ok: true, job: { id: "job" } });
      await new Promise((r) => setTimeout(r, 30));
    });
    // And the second drains afterwards rather than being lost.
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
  });

  it("still applies an in-flight result after the queue array changes", async () => {
    let release: ((v: unknown) => void) | undefined;
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const onAccepted = vi.fn();

    const { result } = renderHook(() => useGenerationQueue({ onAccepted }));
    act(() => result.current.enqueue([request("1")]));
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(1));

    act(() => result.current.enqueue([request("2")]));
    await act(async () => {
      release?.({ ok: true, job: { id: "job" } });
      await new Promise((r) => setTimeout(r, 30));
    });

    // The abandoned-send bug lost this callback entirely.
    expect(onAccepted).toHaveBeenCalled();
  });
});
