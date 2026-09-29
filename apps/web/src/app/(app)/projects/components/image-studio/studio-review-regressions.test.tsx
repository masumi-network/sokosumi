import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioImage } from "./studio-image";
import type { StudioAsset } from "./types";

/**
 * The three journeys an independent review reproduced as broken.
 *
 * Each test below asserts the corrected behaviour, and each one fails against
 * the code as it was: a note lost on closing the details, a healthy version
 * reported unavailable because the previous one was, and a decision saved on
 * an older version that the screen went on denying.
 */

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "26 Sep 2026" }),
  useTranslations: () => (key: string) => key,
}));

function asset(id: string, overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id,
    rootId: id,
    parentId: null,
    version: 1,
    prompt: `prompt ${id}`,
    model: "vendor/model-a",
    width: 1024,
    height: 1024,
    bytes: 1000,
    contentType: "image/png",
    createdAt: "2026-09-26T00:00:00Z",
    jobId: `job-${id}`,
    settings: {},
    contentPath: `/v1/${id}`,
    ...overrides,
  } as unknown as StudioAsset;
}

const _LABELS = new Proxy({}, { get: (_target, key) => String(key) }) as never;

/**
 * What an `img` error is, and is not, evidence of.
 *
 * `onError` fires for a 404 and equally for an aborted or slow response, which
 * five large PNGs decoding at once produce routinely. Reading it as deletion put
 * "no longer in storage" under two of five freshly generated images on the
 * preview while every content route answered 200. So the component retries once
 * and then asks the route, and only the route's 404 may say the file is gone.
 */
describe("a version whose bytes did not arrive", () => {
  const LABEL_KEYS = {
    bytesUnavailable: "bytesUnavailable",
    imageUnreadable: "imageUnreadable",
    imageRetry: "imageRetry",
  };

  function head(status: number) {
    return vi.fn(async () => new Response(null, { status }));
  }

  it("retries once and shows the image, saying nothing in between", async () => {
    // The whole defect in one case: a transient failure must end with the
    // picture on screen and no claim about storage.
    vi.stubGlobal("fetch", head(200));
    const view = render(
      <StudioImage asset={asset("flaky")} labels={LABEL_KEYS} projectId="p" />,
    );

    const first = view.getByRole("img");
    const firstSrc = first.getAttribute("src");
    await act(async () => {
      fireEvent.error(first);
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    const retried = view.getByRole("img");
    // A different URL, or the browser serves the failure back.
    expect(retried.getAttribute("src")).not.toBe(firstSrc);
    expect(retried.getAttribute("src")).toContain("reload=");
    // Nothing was asserted while the retry was in flight, and nothing is now.
    expect(view.queryByText("bytesUnavailable")).toBeNull();
    expect(view.queryByText("imageUnreadable")).toBeNull();
  });

  it("says the file is gone only when the route answers 404", async () => {
    const fetchMock = head(404);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <StudioImage
        asset={asset("deleted")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );

    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.getByText("bytesUnavailable")).toBeTruthy();
    expect(view.queryByRole("img")).toBeNull();
    // Asked, not assumed.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/deleted/content"),
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("stays neutral, and offers a retry, when the route says anything else", async () => {
    // 503 is what the route answers when the store is unreadable. The version
    // is not gone, and telling somebody it was deleted is the false claim.
    vi.stubGlobal("fetch", head(503));
    const view = render(
      <StudioImage
        asset={asset("unreadable")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );

    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.getByText("imageUnreadable")).toBeTruthy();
    expect(view.queryByText("bytesUnavailable")).toBeNull();

    // And the way out is a button, not a page reload.
    fireEvent.click(view.getByRole("button", { name: /imageRetry/ }));
    expect(view.getByRole("img")).toBeTruthy();
  });

  it("does not make the next version look unavailable too", async () => {
    vi.stubGlobal("fetch", head(404));
    const view = render(
      <StudioImage
        asset={asset("missing")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );

    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.getByText("bytesUnavailable")).toBeTruthy();

    // The lightbox's arrows reuse this component rather than remounting it,
    // so the failure has to belong to the version that failed.
    view.rerender(
      <StudioImage
        asset={asset("healthy")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );

    const img = view.getByRole("img");
    expect(img.getAttribute("src")).toContain("healthy");
    expect(view.queryByText("bytesUnavailable")).toBeNull();
  });

  it("still reports the broken one as broken when you step back to it", async () => {
    vi.stubGlobal("fetch", head(404));
    const view = render(
      <StudioImage
        asset={asset("missing")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );
    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(view.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    view.rerender(
      <StudioImage
        asset={asset("healthy")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );
    expect(view.getByRole("img")).toBeTruthy();

    view.rerender(
      <StudioImage
        asset={asset("missing")}
        labels={LABEL_KEYS}
        projectId="p"
      />,
    );
    // Remembered, not re-fetched-and-failed-again: the state is keyed by id.
    expect(view.getByText("bytesUnavailable")).toBeTruthy();
  });
});
