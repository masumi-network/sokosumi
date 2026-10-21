import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type QueuedGeneration,
  useGenerationQueue,
} from "./use-generation-queue";

const startImageGeneration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/image-studio/action", () => ({ startImageGeneration }));

function request(id: string): QueuedGeneration {
  return {
    id,
    projectId: "campaign",
    prompt: `Campaign brief ${id}`,
    modelId: "model-a",
    modelLabel: "Model A",
    settings: { aspectRatio: "4:5", resolution: "2K", seed: 42 },
    referenceAssetIds: ["logo"],
    parentAssetId: "logo",
    idempotencyKey: `ui:${id}`,
  };
}
const accepted = { ok: true, job: { id: "job" } };
const rejected = {
  ok: false,
  uncertain: false,
  kind: "unsupported_settings",
  message: "Unsupported frame",
};

beforeEach(() => {
  vi.resetAllMocks();
  startImageGeneration.mockResolvedValue(accepted);
});

describe("saved submission recovery", () => {
  it.each(["transport throw", "returned network failure", "server failure"])(
    "retries %s using exactly the original purchase intent",
    async (failure) => {
      if (failure === "transport throw") {
        startImageGeneration.mockRejectedValueOnce(
          new Error("connection lost"),
        );
      } else {
        startImageGeneration.mockResolvedValueOnce({
          ok: false,
          uncertain: true,
          kind: null,
          message: failure,
        });
      }
      const { result } = renderHook(() =>
        useGenerationQueue({ onAccepted: vi.fn() }),
      );
      act(() => result.current.enqueue([request("first")]));
      await waitFor(() => expect(result.current.failed).toHaveLength(1));
      expect(result.current.failed[0]).toMatchObject({
        code: "unreachable",
        request: request("first"),
      });
      expect(startImageGeneration).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.retry("first");
        result.current.retry("first");
      });
      await waitFor(() => expect(result.current.queued).toHaveLength(0));
      expect(result.current.failed).toEqual([]);
      expect(startImageGeneration).toHaveBeenCalledTimes(2);
      expect(startImageGeneration.mock.calls[1][0]).toEqual(
        startImageGeneration.mock.calls[0][0],
      );
    },
  );

  it("retains only the unsent remainder after a partially accepted batch runs out of credits", async () => {
    startImageGeneration.mockResolvedValueOnce(accepted).mockResolvedValueOnce({
      ok: false,
      uncertain: false,
      kind: "insufficient_balance",
      message: "No credits",
    });
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useGenerationQueue({ onAccepted }));
    act(() =>
      result.current.enqueue([request("1"), request("2"), request("3")]),
    );
    await waitFor(() => expect(result.current.failed).toHaveLength(2));
    expect(result.current.failed.map(({ request }) => request.id)).toEqual([
      "2",
      "3",
    ]);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    act(() => result.current.retry("2"));
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(3));
    expect(
      startImageGeneration.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual(["ui:1", "ui:2", "ui:2"]);
    expect(result.current.failed.map(({ request }) => request.id)).toEqual([
      "3",
    ]);
  });

  it("keeps a rejected brief when unrelated work is submitted, and can remove it for editing", async () => {
    startImageGeneration.mockResolvedValueOnce(rejected);
    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );
    act(() => result.current.enqueue([request("saved")]));
    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    act(() => result.current.enqueue([request("new")]));
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
    expect(result.current.failed[0]).toMatchObject({
      request: request("saved"),
      message: "Unsupported frame",
      code: null,
    });
    act(() => result.current.dismissFailed("saved"));
    expect(result.current.failed).toEqual([]);
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
  });
  it.each(["insufficient_balance", "access_revoked"])(
    "keeps an earlier uncertain request protected after %s on retry",
    async (kind) => {
      startImageGeneration
        .mockRejectedValueOnce(new Error("lost response"))
        .mockResolvedValueOnce({ ...rejected, kind });
      const { result } = renderHook(() =>
        useGenerationQueue({ onAccepted: vi.fn() }),
      );
      act(() => result.current.enqueue([request("saved")]));
      await waitFor(() => expect(result.current.failed).toHaveLength(1));
      act(() => result.current.retry("saved"));
      await waitFor(() => expect(result.current.failed).toHaveLength(1));
      expect(result.current.failed[0].code).toBe("unreachable");
      expect(startImageGeneration.mock.calls[1][0]).toEqual(
        startImageGeneration.mock.calls[0][0],
      );
    },
  );

  it("retains a request enqueued in the same turn as a balance failure", async () => {
    let release: (value: unknown) => void = () => {};
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useGenerationQueue({ onAccepted: vi.fn() }),
    );
    act(() => result.current.enqueue([request("first")]));
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(1));
    await act(async () => {
      result.current.enqueue([request("new")]);
      release({ ...rejected, kind: "insufficient_balance" });
    });
    expect(result.current.failed.map(({ request }) => request.id)).toEqual([
      "first",
      "new",
    ]);
    expect(result.current.queued).toEqual([]);
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });
});
