import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioAsset, StudioLabels } from "./types";

/**
 * Following a link to one version.
 *
 * `?v=<assetId>` comes off a History row or out of somebody's paste buffer, and
 * it is a promise that the page shows *that* image. Selecting it was not enough:
 * the tile is byte-identical to its neighbours, so the reader landed in a grid
 * of a hundred pictures with no clue which one they had asked to see. This pins
 * the promise rather than the mechanism — the assertion is that the named
 * version is on screen and the others are not.
 */

const scrollIntoView = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  reviewImageVersion: vi.fn(),
  clearImageVersionReview: vi.fn(),
  requestImageJobCancel: vi.fn(),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastError: null,
    lastErrorCode: null,
    clearError: vi.fn(),
  }),
}));

/**
 * The real selection rule, without the polling.
 *
 * `useStudioState` is what turns `initialSelectedAssetId` into a selected
 * asset, so stubbing that away would test nothing. This keeps its rule and
 * drops its `fetch`.
 */
vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
    initialSelectedAssetId,
  }: {
    initialState: { assets: StudioAsset[]; jobs: never[] };
    initialSelectedAssetId: string | null;
  }) => {
    const selectedId = initialSelectedAssetId ?? initialState.assets[0]?.id;
    return {
      state: initialState,
      selectedAsset:
        initialState.assets.find((asset) => asset.id === selectedId) ?? null,
      selectAsset: vi.fn(),
      activeJobs: [],
      applyAsset: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadOlder: vi.fn(),
      hasOlder: false,
      error: null,
    };
  },
}));

const LABELS = new Proxy(
  {
    templateLabels: new Proxy({}, { get: (_target, key: string) => key }),
  } as Record<string, unknown>,
  { get: (target, key: string) => target[key] ?? key },
) as unknown as StudioLabels;

function asset(id: string, version: number, prompt: string): StudioAsset {
  return {
    id,
    rootId: id,
    parentId: null,
    version,
    prompt,
    model: "vendor/model-a",
    width: 1024,
    height: 1024,
    bytes: 1000,
    contentType: "image/png",
    createdAt: "2026-09-27T00:00:00Z",
    jobId: `job-${id}`,
    settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
    contentPath: `/${id}`,
    review: null,
  } as unknown as StudioAsset;
}

const ASSETS = [
  asset("v3", 3, "the newest one"),
  asset("v2", 2, "the one the link names"),
  asset("v1", 1, "the oldest one"),
];

function mount(initialSelectedAssetId: string | null) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={initialSelectedAssetId}
      initialState={{ assets: ASSETS, jobs: [], sessions: [] } as never}
      labels={LABELS}
      projectId="p"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom has no layout, so this is the only observable part of it.
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe("arriving with ?v= naming a version", () => {
  it("opens that version, and only that version", () => {
    mount("v2");

    const dialog = screen.getByRole("dialog");
    // The prompt is how a reader tells one version from another, and the single
    // pane shows it. Its neighbours must not be in there.
    expect(dialog).toHaveTextContent("the one the link names");
    expect(dialog).not.toHaveTextContent("the newest one");
    expect(dialog).not.toHaveTextContent("the oldest one");
  });

  it("scrolls that tile into view, so dismissing lands on it", () => {
    mount("v2");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const scrolledTo = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(scrolledTo.getAttribute("data-asset-id")).toBe("v2");
  });

  it("closes to the gallery rather than to nothing", () => {
    mount("v2");

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    // Still three tiles: the deep link opened a view, it did not filter.
    expect(document.querySelectorAll("figure[data-asset-id]")).toHaveLength(3);
  });
});

describe("arriving without ?v=", () => {
  it("opens on the gallery, with nothing in the way", () => {
    mount(null);

    // An ordinary visit must not get a modal over the composer just because the
    // newest version is selected by default.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelectorAll("figure[data-asset-id]")).toHaveLength(3);
  });
});
