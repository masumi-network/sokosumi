import type { StudioAssetRating } from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioAsset } from "./types";

const mocks = vi.hoisted(() => ({
  rate: vi.fn(),
  hide: vi.fn(),
  viewed: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));
vi.mock("nuqs", async (importOriginal) => {
  const { useState } = await import("react");
  return {
    ...(await importOriginal<typeof import("nuqs")>()),
    useQueryState: () => useState("newest"),
  };
});
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
  prepareStudioAssetSocialMedia: vi.fn(),
  writeStudioAssetCaption: vi.fn(),
}));
vi.mock("@/lib/actions/image-studio/feedback", () => ({
  rateStudioAsset: mocks.rate,
  hideStudioAsset: mocks.hide,
  recordStudioAssetView: mocks.viewed,
}));
vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    failed: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
  }),
}));

const RATING: StudioAssetRating = {
  myThumb: null,
  myReasons: [],
  myComment: null,
  thumbsUp: 0,
  thumbsDown: 0,
  score: 0,
};
const ASSET: StudioAsset = {
  ...RATING,
  id: "ad-a",
  projectId: "project-a",
  projectName: "Launch",
  rootId: "ad-a",
  parentId: null,
  version: 1,
  prompt: "Ceramic mug on a sunlit table",
  model: "vendor/model-a",
  width: 1080,
  height: 1080,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-11-12T10:00:00Z"),
  jobId: "job-a",
  settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
  contentPath: "/ad-a",
};

function mount(assets = [ASSET]) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={null}
      initialState={{ assets, jobs: [], nextCursor: null }}
      labels={TEST_LABELS}
      projectId="project-a"
      readOnly={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewed.mockResolvedValue(undefined);
  mocks.rate.mockImplementation(async ({ feedback }) => ({
    ok: true,
    value: {
      ...RATING,
      myThumb: feedback.thumb,
      myReasons: feedback.reasons ?? [],
      myComment: feedback.comment ?? null,
      thumbsUp: Number(feedback.thumb === 1),
      thumbsDown: Number(feedback.thumb === -1),
    },
  }));
  mocks.hide.mockResolvedValue({ ok: true, value: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("studio ratings", () => {
  it("optimistically presses a thumb and rolls back a failed save", async () => {
    let finish!: (result: { ok: false; error: { message: string } }) => void;
    mocks.rate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    expect(screen.getByRole("button", { name: "up" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "up" })).toBeDisabled();
    await act(async () =>
      finish({ ok: false, error: { message: "unavailable" } }),
    );
    expect(screen.getByRole("button", { name: "up" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(mocks.toast).toHaveBeenCalledWith("Rating.saveFailed");
  });

  it("switches and clears thumbs and saves optional chips and a short comment in the lightbox", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "up" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "up" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("img").closest("button")!);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "up" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(dialog.getByRole("button", { name: "offBrand" }));
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "offBrand" })).toBeEnabled(),
    );
    expect(mocks.rate).toHaveBeenLastCalledWith({
      projectId: "project-a",
      assetId: "ad-a",
      feedback: { thumb: 1, reasons: ["off-brand"], comment: null },
    });
    expect(dialog.getByRole("button", { name: "offBrand" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const comment = dialog.getByRole("textbox", { name: "comment" });
    fireEvent.change(comment, {
      target: { value: "  Logo feels too large  " },
    });
    fireEvent.blur(comment);
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "down" })).toBeEnabled(),
    );
    expect(mocks.rate).toHaveBeenLastCalledWith({
      projectId: "project-a",
      assetId: "ad-a",
      feedback: {
        thumb: 1,
        reasons: ["off-brand"],
        comment: "Logo feels too large",
      },
    });
    fireEvent.click(dialog.getByRole("button", { name: "down" }));
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "down" })).toBeEnabled(),
    );
    expect(dialog.getByRole("button", { name: "down" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(dialog.getByRole("button", { name: "down" }));
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "down" })).toBeEnabled(),
    );
    expect(mocks.rate).toHaveBeenLastCalledWith({
      projectId: "project-a",
      assetId: "ad-a",
      feedback: { thumb: null },
    });
    expect(
      dialog.queryByRole("group", { name: "reasons" }),
    ).not.toBeInTheDocument();
  });

  it("loads Best first from Core and renders the ranking across date and product groups", async () => {
    const best = {
      ...ASSET,
      id: "best",
      score: 1.8,
      product: { id: "mug", name: "Mug" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ assets: [best, ASSET], jobs: [], nextCursor: null }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    mount([ASSET, best]);
    fireEvent.change(screen.getByRole("combobox", { name: "sort" }), {
      target: { value: "best" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-a/image-studio/state?sort=best&assetId=ad-a",
        expect.any(Object),
      ),
    );
    expect(screen.getByRole("combobox", { name: "sort" })).toHaveValue("best");
    expect(
      [...document.querySelectorAll("figure[data-asset-id]")].map((tile) =>
        tile.getAttribute("data-asset-id"),
      ),
    ).toEqual(["best", "ad-a"]);
    expect(
      screen.queryByRole("button", { name: "groupByProduct" }),
    ).not.toBeInTheDocument();
  });

  it("soft-hides an ad from the menu and keeps it out of the gallery", async () => {
    mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "more" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "hide" }));
    await waitFor(() =>
      expect(document.querySelector("figure[data-asset-id]")).toBeNull(),
    );
    expect(mocks.hide).toHaveBeenCalledWith({
      projectId: "project-a",
      assetId: "ad-a",
    });
  });

  it("optimistically hides and restores an ad if hiding fails", async () => {
    let finish!: (result: { ok: false; error: { message: string } }) => void;
    mocks.hide.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "more" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "hide" }));
    expect(document.querySelector("figure[data-asset-id]")).toBeNull();
    await act(async () =>
      finish({ ok: false, error: { message: "unavailable" } }),
    );
    expect(document.querySelector("figure[data-asset-id]")).not.toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("Rating.hideFailed");
  });

  it("debounces lightbox views and records each ad once per open", async () => {
    vi.useFakeTimers();
    const viewed = vi.fn();
    const props = {
      catalog: TEST_CATALOG,
      creditsByAssetId: {},
      elapsedByAssetId: {},
      labels: TEST_LABELS,
      onClose: vi.fn(),
      onSelect: vi.fn(),
      onCaptionChange: vi.fn(),
      onViewed: viewed,
      siblings: [ASSET],
    };
    const view = render(<StudioLightbox {...props} assets={[ASSET]} />);
    await act(async () => vi.advanceTimersByTime(499));
    expect(viewed).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(viewed).toHaveBeenCalledTimes(1);
    view.rerender(<StudioLightbox {...props} assets={[{ ...ASSET }]} />);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(viewed).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<StudioLightbox {...props} assets={[ASSET]} />);
    await act(async () => vi.advanceTimersByTime(500));
    expect(viewed).toHaveBeenCalledTimes(2);
  });
});
