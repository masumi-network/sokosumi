import { StudioLogoPosition } from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { isActive, type StudioAsset, type StudioJob } from "./types";

/**
 * The gallery with work in it.
 *
 * Every capture of this studio on the preview is of an empty project, because
 * generating costs money — so the dense states are pinned here instead: a full
 * grid, the running and queued tiles, the failed-generation
 * notice, and selecting two versions to compare. These are the states whose
 * surface treatment changed when the project became one card, and they are the
 * part of that change a screenshot has never shown.
 */

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  listBatchAssets: vi.fn(),
  saveHeadline: vi.fn(),
  loadBrandKit: vi.fn().mockResolvedValue({ approvedLines: [] }),
  createArchive: vi.fn(),
  saveDownload: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/projects/p/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  // Values included, because the credits figure interpolates a count and a
  // bare key would hide whether the right number reached the tile.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  listStudioBatchAssets: mocks.listBatchAssets,
  saveStudioAdHeadline: mocks.saveHeadline,
  requestImageJobCancel: mocks.cancel,
  prepareStudioAssetSocialMedia: vi.fn(),
  writeStudioAssetCaption: vi.fn(),
}));

vi.mock("@/lib/actions/image-studio/brand-kit", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/actions/image-studio/brand-kit")
  >()),
  getStudioBrandKit: mocks.loadBrandKit,
}));

vi.mock("./studio-headline-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studio-headline-image")>()),
  useStudioHeadlineImage: (
    _asset: StudioAsset,
    _ratio: string,
    _logo: StudioLogoPosition | undefined,
    headline: string | undefined,
  ) => ({
    result: headline
      ? { status: "ready", blob: new Blob([headline]), url: "blob:studio-ad" }
      : null,
    retry: vi.fn(),
  }),
}));

vi.mock("./studio-ad-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studio-ad-download")>()),
  createStudioAdArchive: mocks.createArchive,
  saveStudioDownload: mocks.saveDownload,
}));

vi.mock("eve/react", () => ({
  useEveAgent: () => ({ status: "idle", messages: [] }),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
  }: {
    initialState: { assets: StudioAsset[]; jobs: StudioJob[] };
  }) => ({
    state: initialState,
    selectedAsset: initialState.assets[0] ?? null,
    selectAsset: vi.fn(),
    // The real hook hands down only the jobs still going somewhere. Passing
    // every job made a settled failure render as a pending tile as well as in
    // its notice.
    activeJobs: initialState.jobs.filter((job) => isActive(job)),
    refresh: mocks.refresh,
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    failed: [],
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
  }),
}));

const ASSET = {
  id: "a",
  rootId: "a",
  parentId: null,
  version: 1,
  prompt: "sample",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  createdAt: "2026-09-26T00:00:00Z",
  jobId: "j",
  settings: {},
  contentPath: "/a",
} as unknown as StudioAsset;

function mount(
  assets: StudioAsset[] = [],
  jobs: StudioJob[] = [],
  projectLogo?: string,
  studioLogoPosition?: StudioLogoPosition,
) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={null}
      initialState={{ assets, jobs, sessions: [] } as never}
      labels={TEST_LABELS}
      projectId="p"
      projectLogo={projectLogo}
      studioLogoPosition={studioLogoPosition}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.loadBrandKit.mockResolvedValue({ approvedLines: [] });
  let revision = 0;
  mocks.saveHeadline.mockImplementation(async ({ text }) => ({
    text,
    revision: ++revision,
  }));
  mocks.cancel.mockResolvedValue({ accepted: true });
});

const MODELS = [
  "vendor/model-a",
  "vendor/model-b",
  "vendor/model-a/edit",
] as const;

function manyAssets(count: number): StudioAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    ...ASSET,
    id: `v${i}`,
    rootId: `root-${i % 5}`,
    version: count - i,
    model: MODELS[i % MODELS.length],
    width: i % 3 === 1 ? 1024 : 1536,
    height: i % 3 === 1 ? 1536 : 1024,
    settings: {
      aspectRatio: i % 3 === 1 ? "2:3" : "1:1",
      resolution: i % 2 ? "2K" : "1K",
      outputFormat: "png",
      seed: null,
    },
  })) as unknown as StudioAsset[];
}

function job(
  id: string,
  status: string,
  error?: string,
  failureReason: string | null = "provider_error",
) {
  return {
    id,
    status,
    kind: "GENERATE",
    model: MODELS[0],
    prompt: `prompt for ${id}`,
    settings: {},
    referenceAssetIds: [],
    error: error ?? null,
    failureReason,
    parentAssetId: null,
    assetId: null,
    createdAt: "2026-09-26T00:00:00Z",
    submittedAt: "2026-09-26T00:00:00Z",
    settledAt: null,
    cancelRequestedAt: null,
    retryMayDuplicateCharge: false,
  } as unknown as StudioJob;
}

/**
 * A finished job.
 *
 * `shape` exists because the two routes the studio reads state by disagree: the
 * server component hands down real `Date`s and the poll goes through
 * `NextResponse.json`, which stringifies them. The generated type claims `Date`
 * either way, and believing it took the studio into the error boundary on the
 * deployment — so both shapes are tested.
 */
function settledJob(
  id: string,
  assetId: string,
  elapsedMs: number,
  shape: "date" | "iso" = "iso",
  credits: number | null = 4,
) {
  const submittedAt = new Date("2026-09-26T00:00:00Z");
  const settledAt = new Date(submittedAt.getTime() + elapsedMs);
  const as = (value: Date) => (shape === "date" ? value : value.toISOString());
  return {
    ...job(id, "SUCCEEDED"),
    assetId,
    createdAt: as(submittedAt),
    submittedAt: as(submittedAt),
    settledAt: as(settledAt),
    credits,
  } as unknown as StudioJob;
}

describe("a gallery with work in it", () => {
  it("downloads the whole batch from one ad, including results outside the loaded gallery", async () => {
    const open = { ...ASSET, projectId: "p", batchId: "batch-a" };
    const older = { ...open, id: "older-ad" };
    mocks.listBatchAssets.mockResolvedValueOnce([open, older]);
    mocks.createArchive.mockResolvedValueOnce(new ArrayBuffer(1));

    mount([open]);
    fireEvent.click(screen.getByRole("img").closest("button")!);
    expect(screen.queryByLabelText("logoOnBatch")).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "downloadBatchZip",
      }),
    );
    await waitFor(() => expect(mocks.saveDownload).toHaveBeenCalled());
    expect(mocks.listBatchAssets).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
      batchId: "batch-a",
    });
    expect(mocks.createArchive).toHaveBeenCalledExactlyOnceWith(
      [open, older],
      undefined,
    );
    expect(mocks.saveDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Blob),
      "studio-ad-batch.zip",
    );
  });

  it("uses the logo corner from the ad preview on all ready ads in the batch", async () => {
    const open = { ...ASSET, projectId: "p", batchId: "batch-a" };
    const older = { ...open, id: "older-ad" };
    mocks.listBatchAssets.mockResolvedValueOnce([open, older]);
    mocks.createArchive.mockResolvedValueOnce(new ArrayBuffer(1));

    mount([open], [], "https://example.com/approved-logo.png");
    fireEvent.click(screen.getByRole("img").closest("button")!);
    const batchLogo = screen.getByLabelText("logoOnBatch");
    expect(batchLogo).toHaveValue("");
    fireEvent.change(batchLogo, {
      target: { value: StudioLogoPosition.BOTTOM_LEFT },
    });

    fireEvent.click(screen.getByRole("button", { name: "previewAd" }));
    const preview = within(screen.getByRole("dialog", { name: "previewAd" }));
    const previewLogo = preview.getByLabelText("logoOnCreative");
    expect(previewLogo).toHaveValue(StudioLogoPosition.BOTTOM_LEFT);
    fireEvent.change(previewLogo, {
      target: { value: StudioLogoPosition.TOP_LEFT },
    });
    fireEvent.click(preview.getByRole("button", { name: "close" }));
    expect(batchLogo).toHaveValue(StudioLogoPosition.TOP_LEFT);

    fireEvent.click(screen.getByRole("button", { name: "downloadBatchZip" }));
    await waitFor(() => expect(mocks.saveDownload).toHaveBeenCalled());
    expect(mocks.createArchive).toHaveBeenCalledExactlyOnceWith(
      [open, older],
      StudioLogoPosition.TOP_LEFT,
    );
    expect(mocks.saveDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Blob),
      "studio-branded-ad-batch.zip",
    );
  });

  it.each([
    { override: false, expected: StudioLogoPosition.BOTTOM_LEFT },
    { override: true, expected: undefined },
  ])(
    "uses the project default unless this batch overrides it ($override)",
    async ({ override, expected }) => {
      const open = { ...ASSET, projectId: "p", batchId: "batch-a" };
      mocks.listBatchAssets.mockResolvedValueOnce([open]);
      mocks.createArchive.mockResolvedValueOnce(new ArrayBuffer(1));

      mount(
        [open],
        [],
        "https://example.com/logo.png",
        StudioLogoPosition.BOTTOM_LEFT,
      );
      fireEvent.click(screen.getByRole("img").closest("button")!);
      const batchLogo = screen.getByLabelText("logoOnBatch");
      expect(batchLogo).toHaveValue(StudioLogoPosition.BOTTOM_LEFT);
      if (override) fireEvent.change(batchLogo, { target: { value: "" } });

      fireEvent.click(screen.getByRole("button", { name: "previewAd" }));
      const preview = within(screen.getByRole("dialog", { name: "previewAd" }));
      expect(preview.getByLabelText("logoOnCreative")).toHaveValue(
        expected ?? "",
      );
      fireEvent.click(preview.getByRole("button", { name: "close" }));
      fireEvent.click(screen.getByRole("button", { name: "downloadBatchZip" }));
      await waitFor(() =>
        expect(mocks.createArchive).toHaveBeenCalledExactlyOnceWith(
          [open],
          expected,
        ),
      );
    },
  );

  it("downloads only approved headline copy and blocks a line removed during review", async () => {
    const active = "Made with reclaimed clay.";
    const removed = "Save 50% this weekend.";
    mocks.loadBrandKit
      .mockResolvedValueOnce({ approvedLines: [active, removed] })
      .mockResolvedValue({ approvedLines: [active] });

    mount([{ ...ASSET, projectId: "p" }]);
    fireEvent.click(screen.getByRole("img").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "previewAd" }));

    const preview = within(screen.getByRole("dialog", { name: "previewAd" }));
    const select = await preview.findByLabelText("approvedHeadline");
    const download = preview.getByRole("button", {
      name: /^downloadPlacementPng/,
    });

    fireEvent.change(select, { target: { value: removed } });
    await waitFor(() => {
      expect(select).toHaveValue(removed);
      expect(download).toBeEnabled();
    });
    fireEvent.click(download);
    await waitFor(() =>
      expect(
        preview.queryByRole("option", { name: removed }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.saveDownload).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: active } });
    await waitFor(() => {
      expect(select).toHaveValue(active);
      expect(download).toBeEnabled();
    });
    fireEvent.click(download);
    await waitFor(() =>
      expect(mocks.saveDownload).toHaveBeenCalledExactlyOnceWith(
        expect.any(Blob),
        "ad-v1-1x1-headline.png",
      ),
    );
  });

  it("reviews different approved headlines for all ready batch ads, including an unloaded result", async () => {
    const open = {
      ...ASSET,
      projectId: "p",
      batchId: "batch-a",
      product: { id: "a", name: "Mug" },
    };
    const older = {
      ...open,
      id: "older-ad",
      product: { id: "b", name: "Kettle" },
    };
    const first = "A slower morning.";
    const second = "Pour with precision.";
    mocks.listBatchAssets.mockResolvedValue([open, older]);
    mocks.loadBrandKit.mockResolvedValue({ approvedLines: [first, second] });
    mocks.createArchive.mockResolvedValueOnce(new ArrayBuffer(1));

    mount([open]);
    fireEvent.click(screen.getByRole("img").closest("button")!);
    fireEvent.click(
      screen.getByRole("button", { name: "reviewBatchHeadlines" }),
    );
    const review = within(
      screen.getByRole("dialog", { name: "reviewBatchHeadlines" }),
    );
    const pickers = await review.findAllByLabelText("approvedHeadline");
    expect(pickers).toHaveLength(2);
    expect(review.getByText("Kettle")).toBeVisible();
    fireEvent.change(pickers[0], { target: { value: first } });
    await waitFor(() => expect(pickers[0]).toHaveValue(first));
    fireEvent.change(pickers[1], { target: { value: second } });
    await waitFor(() => expect(pickers[1]).toHaveValue(second));

    const download = review.getByRole("button", { name: "downloadBatchZip" });
    mocks.loadBrandKit.mockResolvedValueOnce({ approvedLines: [first] });
    fireEvent.click(download);
    await waitFor(() => expect(mocks.loadBrandKit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(download).toBeEnabled());
    expect(mocks.createArchive).not.toHaveBeenCalled();

    fireEvent.click(download);
    await waitFor(() =>
      expect(mocks.createArchive).toHaveBeenCalledExactlyOnceWith(
        [open, older],
        undefined,
        { [open.id]: first, [older.id]: second },
      ),
    );
  });

  it("hands the selected ad to the assistant and keeps the generation draft", () => {
    const product = { id: "mug", name: "Stoneware mug" };
    mount([{ ...ASSET, projectId: "p", product }]);
    const draft = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(draft, { target: { value: "An unrelated draft" } });

    fireEvent.click(screen.getByRole("img").closest("button")!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Assistant.edit" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const panel = screen.getByRole("complementary", {
      name: "Assistant.title",
    });
    expect(
      within(panel).getByText(/editingProduct.*Stoneware mug/),
    ).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "close" }));
    expect(
      screen.queryByRole("complementary", { name: "Assistant.title" }),
    ).not.toBeInTheDocument();
    expect(draft).toHaveValue("An unrelated draft");
  });

  it("groups ads across days by product and project, and can return to date grouping", () => {
    const product = { id: "mug", name: "Stoneware mug" };
    const assets = [
      { ...ASSET, id: "new", projectId: "p", projectName: "Launch", product },
      {
        ...ASSET,
        id: "other",
        projectId: "other",
        projectName: "Summer",
        product,
      },
      {
        ...ASSET,
        id: "old",
        projectId: "p",
        projectName: "Launch",
        createdAt: new Date("2026-09-24T00:00:00Z"),
        product: { ...product, name: "Clay mug" },
      },
      { ...ASSET, id: "no-product" },
    ];
    mount(assets);

    const launch = screen.getByRole("heading", {
      name: "Stoneware mug · Launch",
    }).parentElement;
    expect(launch?.querySelectorAll("figure[data-asset-id]")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Stoneware mug · Summer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "today" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "groupByProduct" }));

    expect(
      screen.queryByRole("heading", { name: /Stoneware mug/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "today" })).toHaveLength(2);
  });

  it("renders a bare wall of pictures, each with its selection box drawn", () => {
    mount(manyAssets(14));

    const tiles = document.querySelectorAll("figure[data-asset-id]");
    expect(tiles).toHaveLength(14);
    // No caption under the picture: the prompt, model, time and credits live
    // in the viewer, not on the tile.
    expect(document.querySelectorAll("figcaption")).toHaveLength(0);
    // The selection box is always in the DOM and never gated on hover.
    for (const tile of tiles) {
      const box = tile.querySelector("button[aria-pressed]");
      expect(box).not.toBeNull();
      expect(box?.className).not.toContain("opacity-0");
      expect(tile.className).toContain("border-border");
      expect(tile.className).not.toMatch(/\bshadow(?:-lg|-md|-sm)?\b/);
      expect(box?.className).not.toMatch(/\bshadow(?:-lg|-md|-sm)?\b/);
    }
    // Decisions are gone entirely.
    expect(screen.queryByRole("button", { name: "filterApproved" })).toBeNull();
  });

  it("gives each tile its own aspect ratio, so mixed frames pack cleanly", () => {
    mount(manyAssets(3));

    const ratios = [
      ...document.querySelectorAll("figure[data-asset-id] button > span"),
    ].map((node) => (node as HTMLElement).style.aspectRatio.replace(/\s/g, ""));
    expect(new Set(ratios)).toEqual(new Set(["1536/1024", "1024/1536"]));
  });

  it("shows running and queued work as tiles, and a failure as a notice", () => {
    mount(manyAssets(6), [
      job("running", "RUNNING"),
      job("queued", "QUEUED"),
      job("failed", "FAILED", "The provider refused it."),
    ]);

    // Pending work sits in the grid with the results, not in a separate list.
    // `getAllBy`: the label is exact text on more than one node in the tile.
    expect(screen.getAllByText("generating").length).toBeGreaterThan(0);
    expect(screen.getAllByText("queued").length).toBeGreaterThan(0);
    // Its cancel control is on the tile it belongs to, one per active job,
    // rather than in a separate row of buttons above the gallery.
    const pendingTiles = [...document.querySelectorAll("li")].filter((li) =>
      /generating|queued/.test(li.textContent ?? ""),
    );
    expect(pendingTiles).toHaveLength(2);
    for (const tile of pendingTiles) {
      expect(
        within(tile as HTMLElement).getByRole("button", { name: "cancel" }),
      ).toBeInTheDocument();
    }
    // A settled failure is stated above the gallery.
    expect(screen.getByRole("status")).toHaveTextContent("provider_error");
  });

  /**
   * What a failure says, and what it does not say.
   *
   * It used to print `job.error` verbatim, which on the preview read
   * "Unexpected status code: 422" — an HTTP detail, in English, shown to
   * somebody who asked for a picture. The provider's words are kept, one
   * disclosure away, for whoever has to chase fal about them.
   */
  it("states a failure in a sentence, with the provider's words behind a toggle", () => {
    mount(manyAssets(2), [
      job("failed", "FAILED", "Unexpected status code: 422"),
    ]);

    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("provider_error");
    // Present in the DOM — a `details` only hides its own body visually — but
    // never in the sentence a reader gets handed.
    const summary = screen.getByText("failedDetails");
    expect(summary.closest("details")).toHaveTextContent(
      "Unexpected status code: 422",
    );
    expect(alert.querySelector("p")?.textContent).not.toContain("422");
  });

  it("offers no disclosure when the provider said nothing", () => {
    mount(manyAssets(2), [job("failed", "FAILED")]);

    expect(screen.getByRole("status")).toHaveTextContent("provider_error");
    expect(screen.queryByText("failedDetails")).toBeNull();
  });

  /**
   * Core reports a stable code now, and the sentence is chosen by it.
   *
   * The point is that the reader gets *their* language: the code is what Web
   * branches on, and Core's English `error` string — itself a real sentence
   * since the last Core pass — never becomes the headline.
   */
  it("says why, per the reason Core reported", () => {
    mount(manyAssets(2), [
      job("failed", "FAILED", "HTTP 409 from upstream", "cancelled"),
    ]);

    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("cancelled");
    expect(alert).not.toHaveTextContent("provider_error");
  });

  /**
   * The money sentence, and what it must not say.
   *
   * Images are charged on success, so a generation that produced none was never
   * charged — there is nothing to give back and nothing that says otherwise. It
   * is unconditional for that reason: no per-job flag decides it.
   */
  it("says a failed generation cost nothing, without a refund in sight", () => {
    mount(manyAssets(2), [
      job("failed", "FAILED", "HTTP 500 from upstream", "provider_error"),
    ]);

    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("failedNoCharge");
    // No wording about money coming back, in any of the three languages this
    // ships in. The strings are keys here, so this guards the shape rather than
    // the prose — the locale files are where the prose is checked.
    expect(alert.textContent ?? "").not.toMatch(
      /refund|erstatt|reembols|devuelt/i,
    );
  });

  it("has a sentence for a row from before Core recorded reasons", () => {
    mount(manyAssets(2), [
      job("failed", "FAILED", "Something went wrong", null),
    ]);

    // Not a blank line and not the raw string: `failureReason` is null on every
    // job that settled before the column existed.
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("failedBodyUnreported");
    expect(alert.querySelector("p")?.textContent).not.toContain(
      "Something went wrong",
    );
  });

  it("keeps generation time and credits off the tile", () => {
    mount(
      [
        {
          ...ASSET,
          id: "v1",
          settings: {
            aspectRatio: "1:1",
            resolution: "1K",
            outputFormat: "png",
            seed: null,
          },
        } as unknown as StudioAsset,
      ],
      [settledJob("j1", "v1", 3_200)],
    );

    const tile = document.querySelector("figure[data-asset-id]");
    expect(tile).not.toBeNull();
    // Time and credits are not on the tile any more; they are in the viewer.
    expect(tile?.textContent).toBe("");
  });

  /**
   * The gallery wraps each tile in a button that opens the lightbox, and the
   * recovery control from a broken thumbnail sits inside it. Without
   * `stopPropagation` the click reached both, so recovering a thumbnail threw
   * the reader into the full-screen viewer — which is not what they asked for.
   */
  it("recovers a broken thumbnail without opening the lightbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    mount([{ ...ASSET, id: "v1" } as unknown as StudioAsset]);

    // Two failures and a 503 probe: the neutral placeholder with its button.
    await act(async () => {
      fireEvent.error(screen.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(screen.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(screen.getByRole("button", { name: /imageRetry/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    // And it did retry: the image is back, asking for a fresh URL.
    expect(screen.getByRole("img").getAttribute("src")).toContain("reload=1-");
  });

  it("offers comparison once two versions are selected", () => {
    mount(manyAssets(6));

    const compare = () =>
      screen.getByRole("button", { name: "compareSelected" });
    expect(
      screen.queryByRole("button", { name: "compareSelected" }),
    ).toBeNull();

    const [first, second] = screen.getAllByRole("button", { name: "select" });
    fireEvent.click(first);
    // One is not a comparison.
    expect(compare()).toBeDisabled();

    fireEvent.click(second);
    expect(compare()).toBeEnabled();

    fireEvent.click(compare());
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("figure")).toHaveLength(2);
  });
});
