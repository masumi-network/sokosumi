import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG } from "./studio-fixtures";
import {
  isActive,
  type StudioAsset,
  type StudioJob,
  type StudioLabels,
} from "./types";

/**
 * The gallery with work in it.
 *
 * Every capture of this studio on the preview is of an empty project, because
 * generating costs money — so the dense states are pinned here instead: a full
 * grid, the review badges, the running and queued tiles, the failed-generation
 * notice, and selecting two versions to compare. These are the states whose
 * surface treatment changed when the project became one card, and they are the
 * part of that change a screenshot has never shown.
 */

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/projects/p/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  reviewImageVersion: mocks.review,
  clearImageVersionReview: mocks.clear,
  requestImageJobCancel: mocks.cancel,
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
    applyAsset: vi.fn(),
    refresh: mocks.refresh,
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastError: null,
    clearError: vi.fn(),
  }),
}));

const LABELS = new Proxy(
  { examplePrompts: ["Example one", "Example two"] } as Record<string, unknown>,
  { get: (target, key: string) => target[key] ?? key },
) as unknown as StudioLabels;

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
  review: null,
} as unknown as StudioAsset;

function mount(assets: StudioAsset[] = [], jobs: StudioJob[] = []) {
  return render(
    <ImageStudio
      initialSelectedAssetId={null}
      initialState={
        { catalog: TEST_CATALOG, assets, jobs, sessions: [] } as never
      }
      labels={LABELS}
      projectId="p"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.review.mockResolvedValue({
    ...ASSET,
    review: { decision: "APPROVED" },
  });
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
      placementId: i % 4 === 1 ? "reels" : null,
    },
    ...(i % 5 === 0
      ? {
          review: {
            decision: "APPROVED",
            feedback: "Use this one.",
            createdAt: "2026-09-26T00:00:00Z",
          },
        }
      : i % 5 === 2
        ? {
            review: {
              decision: "REJECTED",
              feedback: "Too warm.",
              createdAt: "2026-09-26T00:00:00Z",
            },
          }
        : {}),
  })) as unknown as StudioAsset[];
}

function job(id: string, status: string, error?: string) {
  return {
    id,
    status,
    kind: "GENERATE",
    model: MODELS[0],
    prompt: `prompt for ${id}`,
    settings: {},
    referenceAssetIds: [],
    error: error ?? null,
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
  } as unknown as StudioJob;
}

describe("a gallery with work in it", () => {
  it("renders a full grid of versions with their provenance", () => {
    mount(manyAssets(14));

    expect(document.querySelectorAll("figure[data-asset-id]")).toHaveLength(14);
    // The model is on every tile, which is the provenance requirement, and
    // the filters appear because there is now something to filter.
    for (const name of [
      "filterAll",
      "filterApproved",
      "filterRejected",
      "filterUndecided",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Decisions are carried by an icon *and* a word, never colour alone.
    expect(screen.getAllByText("approved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("rejected").length).toBeGreaterThan(0);
  });

  it("narrows to a decision and back", () => {
    mount(manyAssets(14));
    const all = document.querySelectorAll("figure[data-asset-id]").length;

    fireEvent.click(screen.getByRole("button", { name: "filterApproved" }));
    const approved = document.querySelectorAll("figure[data-asset-id]").length;
    expect(approved).toBeGreaterThan(0);
    expect(approved).toBeLessThan(all);

    fireEvent.click(screen.getByRole("button", { name: "filterAll" }));
    expect(document.querySelectorAll("figure[data-asset-id]")).toHaveLength(
      all,
    );
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
    // A settled failure is stated above the gallery, with its reason.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider refused it.",
    );
  });

  /**
   * The active filter used to be `bg-secondary text-foreground`.
   *
   * Both tokens follow the page in the same direction and `--secondary` is its
   * inverse, so the pair rendered near-black on near-black in light mode and
   * near-white on white in dark: the one chip saying what the gallery was
   * narrowed to was the one chip nobody could read, in both themes. This pins
   * the pairing rather than the colour, because the pairing is the bug.
   */
  it("pairs the active filter's fill with its own foreground token", () => {
    mount(manyAssets(6));

    const active = screen.getByRole("button", { name: "filterAll" });
    expect(active.className).toContain("bg-secondary");
    expect(active.className).toContain("text-secondary-foreground");
    expect(active.className).not.toMatch(/(^|\s)text-foreground(\s|$)/);
  });

  it("pairs the rejected badge the same way", () => {
    mount(manyAssets(6));

    const badge = screen
      .getAllByText("rejected")
      .map((node) => node.closest("span"))
      .find((node) => node?.className.includes("bg-secondary"));
    expect(badge?.className).toContain("text-secondary-foreground");
    expect(badge?.className).not.toContain("text-muted-foreground");
  });

  /**
   * What a batch across several models is actually read for.
   *
   * The time is measured — the provider's own submit-to-settle interval, off
   * the job row. The money is not: nothing in this studio records what fal
   * billed, so the tile shows the published list price for these settings and
   * marks it as an approximation.
   */
  it("shows each version's generation time and estimated cost", () => {
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
            placementId: null,
          },
        } as unknown as StudioAsset,
      ],
      [settledJob("j1", "v1", 3_200)],
    );

    const tile = document.querySelector("figure[data-asset-id]");
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain("3.2s");
    // Model A is $0.04 an image at 1K in TEST_CATALOG, and the tilde is what
    // says this is a list price rather than a charge.
    expect(tile?.textContent).toContain("~$0.04");
  });

  it("reads the same timing when the dates arrive as Date objects", () => {
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
            placementId: null,
          },
        } as unknown as StudioAsset,
      ],
      [settledJob("j1", "v1", 3_200, "date")],
    );

    expect(
      document.querySelector("figure[data-asset-id]")?.textContent,
    ).toContain("3.2s");
  });

  it("says nothing about time for a version whose job is off the page", () => {
    mount(
      [{ ...ASSET, id: "v1" } as unknown as StudioAsset],
      // No job carries this version, which is what an older version looks like
      // once its job has fallen out of the most recent page of them.
      [settledJob("j1", "somebody-else", 3_200)],
    );

    const text = document.querySelector("figure[data-asset-id]")?.textContent;
    // No invented duration, and no zero either: absent is not "took no time".
    expect(text).not.toMatch(/\d+(\.\d+)?s/);
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
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
  });
});
