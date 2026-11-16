import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchStudioAd } from "./studio-ad-download";
import {
  renderStudioHeadline,
  type StudioHeadlineLook,
} from "./studio-ad-headline";
import { useStudioHeadlineImage } from "./studio-headline-image";

vi.mock("./studio-ad-download", () => ({ fetchStudioAd: vi.fn() }));
vi.mock("./studio-ad-headline", () => ({ renderStudioHeadline: vi.fn() }));

const ASSET = { id: "asset-a", projectId: "project-a" };
const LOOK = { colors: ["#A33421", "#F5EBDD"], fonts: ["Playfair Display"] };

describe("Studio headline preview image", () => {
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
});
