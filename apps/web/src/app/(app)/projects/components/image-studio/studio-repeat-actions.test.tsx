import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioAsset } from "./types";

/**
 * Making the next image: the actions on a result's hover, the docked composer,
 * and results grouped by day. Driven through the real studio, asserting on what
 * the queue was handed, because a re-roll that reuses the seed or the
 * reference is a button that visibly works and buys the same picture twice.
 */

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (date: Date) => `day:${date.toISOString().slice(0, 10)}`,
  }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
    initialSelectedAssetId,
  }: {
    initialState: { assets: StudioAsset[] };
    initialSelectedAssetId: string | null;
  }) => ({
    state: { ...initialState, jobs: [] },
    selectedAsset:
      initialState.assets.find(
        (asset) => asset.id === initialSelectedAssetId,
      ) ?? null,
    selectAsset: vi.fn(),
    activeJobs: [],
    refresh: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: mocks.enqueue,
    waitingForSlot: false,
    lastError: null,
    clearError: vi.fn(),
  }),
}));

const ASSET = {
  id: "a",
  rootId: "a",
  parentId: null,
  version: 1,
  prompt: "a red fox",
  model: "vendor/model-a",
  width: 1024,
  height: 1536,
  bytes: 1000,
  contentType: "image/png",
  createdAt: "2026-09-26T12:00:00Z",
  jobId: "j",
  settings: {
    aspectRatio: "2:3",
    resolution: "2K",
    outputFormat: "png",
    seed: 7,
  },
  contentPath: "/a",
} as unknown as StudioAsset;

function mount(
  assets: StudioAsset[] = [ASSET],
  catalog = TEST_CATALOG,
  selectedAssetId: string | null = null,
) {
  return render(
    <ImageStudio
      catalog={catalog}
      initialSelectedAssetId={selectedAssetId}
      initialState={{ assets, jobs: [], sessions: [] } as never}
      labels={TEST_LABELS}
      projectId="p"
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("actions on a result", () => {
  it("re-rolls the same brief with no seed and no reference", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "reroll" }));

    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      prompt: "a red fox",
      modelId: "model-a",
      parentAssetId: null,
      referenceAssetIds: [],
      settings: { aspectRatio: "2:3", resolution: "2K", seed: null },
    });
  });

  it("makes a variation from the image itself", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "regenerate" }));

    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests[0]).toMatchObject({
      parentAssetId: "a",
      referenceAssetIds: ["a"],
    });
  });

  it("refines the image with its frame even when a selected model cannot edit", async () => {
    const asset: StudioAsset = {
      ...ASSET,
      projectId: "source-project",
      settings: { ...ASSET.settings, aspectRatio: "16:9" },
    };
    const catalog = {
      ...TEST_CATALOG,
      models: TEST_CATALOG.models.map((model) =>
        model.id === "model-b"
          ? { ...model, editEndpoint: null, maxReferences: 0 }
          : model,
      ),
    };
    mount([asset], catalog, asset.id);
    fireEvent.click(screen.getByRole("button", { name: "refine" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByText("v1")).toBeInTheDocument();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    await waitFor(() => expect(prompt).toHaveFocus());
    fireEvent.change(prompt, {
      target: { value: "Add the text Hello and make the background blue" },
    });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });

    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      projectId: "source-project",
      modelId: "model-a",
      prompt: "Add the text Hello and make the background blue",
      parentAssetId: asset.id,
      referenceAssetIds: [asset.id],
      settings: { aspectRatio: "16:9", resolution: "2K", seed: null },
    });
  });

  it("keeps the base visible and blocks submission until an editing model is selected", () => {
    const catalog = {
      ...TEST_CATALOG,
      models: TEST_CATALOG.models.map((model) => ({
        ...model,
        editEndpoint: null,
        maxReferences: 0,
      })),
    };
    mount([ASSET], catalog, ASSET.id);
    fireEvent.click(screen.getByRole("button", { name: "refine" }));
    expect(screen.getByText("v1")).toBeInTheDocument();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Change the background" } });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
    expect(screen.getByRole("button", { name: "generateOne" })).toBeDisabled();
    expect(mocks.enqueue).not.toHaveBeenCalled();

    // Explicitly removing the base restores ordinary text-to-image generation.
    const composer = screen.getByRole("region", { name: "composerTitle" });
    fireEvent.click(
      within(composer).getByRole("button", { name: "clearSelection" }),
    );
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toMatchObject({
        parentAssetId: null,
        referenceAssetIds: [],
      });
    }
  });

  it("puts the prompt and frame back in the composer, without generating", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "reusePrompt" }));

    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    expect(prompt).toHaveValue("a red fox");
    expect(prompt).toHaveFocus();
    expect(screen.getByText("2:3 · 2K · png")).toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("the page around the results", () => {
  it("groups results by day, oldest first (newest at the bottom), under a date heading", () => {
    mount([
      { ...ASSET, id: "b", createdAt: "2026-09-28T12:00:00Z" as never },
      { ...ASSET, id: "c", createdAt: "2026-09-28T09:00:00Z" as never },
      ASSET,
    ]);
    const days = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(days).toEqual(["day:2026-09-26", "day:2026-09-28"]);
  });

  it("docks the composer below the results once there are some", () => {
    mount();
    const results = screen.getByRole("button", { name: /openDetails/ });
    const composer = screen.getByRole("region", { name: "composerTitle" });
    expect(
      results.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the empty-state carousel above the composer", () => {
    mount([]);
    const composer = screen.getByRole("region", { name: "composerTitle" });
    const tile = screen.getByRole("button", { name: "poster" });
    expect(
      tile.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("generates on Cmd+Enter from the prompt", () => {
    mount([]);
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "a fox" } });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
});
