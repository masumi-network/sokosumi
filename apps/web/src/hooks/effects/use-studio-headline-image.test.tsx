import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchStudioAd } from "@/app/projects/components/image-studio/studio-ad-download";
import {
  renderStudioHeadline,
  type StudioHeadlineLook,
} from "@/app/projects/components/image-studio/studio-ad-headline";

import { useStudioHeadlineImage } from "./use-studio-headline-image";

vi.mock("@/app/projects/components/image-studio/studio-ad-download", () => ({
  fetchStudioAd: vi.fn(),
}));
vi.mock("@/app/projects/components/image-studio/studio-ad-headline", () => ({
  renderStudioHeadline: vi.fn(),
}));

const ASSET = { id: "asset-a", projectId: "project-a" };
const LOOK = { colors: ["#A33421", "#F5EBDD"], fonts: ["Playfair Display"] };

describe("useStudioHeadlineImage", () => {
  beforeEach(() => {
    vi.mocked(fetchStudioAd).mockImplementation(async () => new Response("ad"));
    vi.mocked(renderStudioHeadline).mockResolvedValue(new Blob(["rendered"]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:headline");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("passes the brand look to the shared renderer and renders again after it changes", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ look }: { look: StudioHeadlineLook }) =>
        useStudioHeadlineImage(
          ASSET,
          "1:1",
          undefined,
          "A slower morning.",
          [],
          look,
        ),
      { initialProps: { look: LOOK } },
    );
    await waitFor(() => expect(result.current.result?.status).toBe("ready"));
    expect(renderStudioHeadline).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "A slower morning.",
      undefined,
      LOOK,
    );

    const changed = { colors: ["#123456"], fonts: ["Inter"] };
    rerender({ look: changed });
    await waitFor(() => expect(renderStudioHeadline).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.result?.status).toBe("ready"));
    expect(renderStudioHeadline).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "A slower morning.",
      undefined,
      changed,
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("still produces a preview without a brand look", async () => {
    const { result } = renderHook(() =>
      useStudioHeadlineImage(ASSET, "1:1", undefined, "A slower morning."),
    );
    await waitFor(() => expect(result.current.result?.status).toBe("ready"));
    expect(renderStudioHeadline).toHaveBeenCalledWith(
      expect.any(Blob),
      "A slower morning.",
      undefined,
      undefined,
    );
  });

  it("reports an error and retries when retry() is called", async () => {
    vi.mocked(fetchStudioAd)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("ad"));

    const { result } = renderHook(() =>
      useStudioHeadlineImage(ASSET, "1:1", undefined, "Retry me"),
    );

    await waitFor(() => expect(result.current.result?.status).toBe("error"));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.result?.status).toBe("ready"));
    expect(fetchStudioAd).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight render on unmount without creating an object URL", async () => {
    let capturedSignal: AbortSignal | undefined;
    const pending = Promise.withResolvers<Response>();
    vi.mocked(fetchStudioAd).mockImplementation((_asset, _opts, signal) => {
      capturedSignal = signal;
      return pending.promise;
    });

    const { unmount } = renderHook(() =>
      useStudioHeadlineImage(ASSET, "1:1", undefined, "Abort me"),
    );
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(new Response("ad"));
      await pending.promise;
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
