import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TEST_CATALOG } from "./studio-fixtures";
import { StudioImage } from "./studio-image";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioAsset, StudioState } from "./types";
import { useStudioState } from "./use-studio-state";

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
    review: null,
    ...overrides,
  } as unknown as StudioAsset;
}

const LABELS = new Proxy({}, { get: (_target, key) => String(key) }) as never;

describe("a version whose bytes are missing", () => {
  it("does not make the next version look unavailable too", () => {
    const view = render(
      <StudioImage
        asset={asset("missing")}
        label="bytes unavailable"
        projectId="p"
      />,
    );

    fireEvent.error(view.getByRole("img"));
    expect(view.queryByRole("img")).toBeNull();
    expect(view.getByText("bytes unavailable")).toBeTruthy();

    // The lightbox's arrows reuse this component rather than remounting it,
    // so the failure has to belong to the version that failed.
    view.rerender(
      <StudioImage
        asset={asset("healthy")}
        label="bytes unavailable"
        projectId="p"
      />,
    );

    const img = view.getByRole("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("healthy");
    expect(view.queryByText("bytes unavailable")).toBeNull();
  });

  it("still reports the broken one as broken when you step back to it", () => {
    const view = render(
      <StudioImage asset={asset("missing")} label="gone" projectId="p" />,
    );
    fireEvent.error(view.getByRole("img"));

    view.rerender(
      <StudioImage asset={asset("healthy")} label="gone" projectId="p" />,
    );
    expect(view.getByRole("img")).toBeTruthy();

    view.rerender(
      <StudioImage asset={asset("missing")} label="gone" projectId="p" />,
    );
    // Remembered, not re-fetched-and-failed-again: the state is keyed by id.
    expect(view.getByText("gone")).toBeTruthy();
  });
});

describe("an unsaved review note", () => {
  const base = {
    assets: [asset("a")],
    busy: false,
    catalog: TEST_CATALOG,
    labels: LABELS,
    onApprove: vi.fn(),
    onClearReview: vi.fn(),
    onClose: vi.fn(),
    onRegenerate: vi.fn(),
    onStep: vi.fn(),
    onUseAsReference: vi.fn(),
    onReject: vi.fn(),
    projectId: "p",
    stepping: { hasPrevious: false, hasNext: false },
  };

  it("is reported upward instead of being kept inside the lightbox", () => {
    const onDraftChange = vi.fn();
    render(
      <StudioLightbox {...base} drafts={{}} onDraftChange={onDraftChange} />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Crop is tight on the left" },
    });

    // Keyed by the version it was written on, so it cannot be filed on
    // another one.
    expect(onDraftChange).toHaveBeenCalledWith(
      "a",
      "Crop is tight on the left",
    );
  });

  it("survives the lightbox closing and reopening", () => {
    // What closing actually does is unmount it; the studio above keeps the
    // drafts, so reopening has to show the note again.
    const drafts = { a: "Crop is tight on the left" };
    const view = render(
      <StudioLightbox {...base} drafts={drafts} onDraftChange={vi.fn()} />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Crop is tight on the left",
    );

    view.unmount();

    render(
      <StudioLightbox {...base} drafts={drafts} onDraftChange={vi.fn()} />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Crop is tight on the left",
    );
  });

  it("gives way to the saved feedback once there is no draft", () => {
    render(
      <StudioLightbox
        {...base}
        assets={[
          asset("a", {
            review: { decision: "APPROVED", feedback: "Saved note" },
          } as Partial<StudioAsset>),
        ]}
        drafts={{}}
        onDraftChange={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Saved note",
    );
  });
});

describe("reviewing a version that is not the selected one", () => {
  const newest = asset("newest");
  const older = asset("older");

  function initialState(): StudioState {
    return {
      catalog: TEST_CATALOG,
      assets: [newest, older],
      jobs: [],
      sessions: [],
      nextCursor: null,
    } as unknown as StudioState;
  }

  it("keeps the saved decision through a refresh that does not return it", async () => {
    // The refresh pins only the selected version and returns the newest page.
    // An older version reviewed from comparison is in neither, so before the
    // fix its row was retained with the decision it had before the save.
    const serverNewestPage = {
      ...initialState(),
      assets: [newest],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(serverNewestPage))),
    );

    const { result } = renderHook(() =>
      useStudioState({
        projectId: "p",
        initialState: initialState(),
        initialSelectedAssetId: "newest",
      }),
    );

    const approved = asset("older", {
      review: { decision: "APPROVED", feedback: "Saved from compare" },
    } as Partial<StudioAsset>);

    act(() => result.current.applyAsset(approved));
    expect(
      result.current.state.assets.find((a) => a.id === "older")?.review
        ?.decision,
    ).toBe("APPROVED");

    await act(async () => {
      await result.current.refresh();
    });

    const after = result.current.state.assets.find((a) => a.id === "older");
    expect(after?.review?.decision).toBe("APPROVED");
    expect(after?.review?.feedback).toBe("Saved from compare");

    vi.unstubAllGlobals();
  });

  it("applies a cleared review the same way", async () => {
    const withReview = asset("older", {
      review: { decision: "REJECTED", feedback: "no" },
    } as Partial<StudioAsset>);
    const state = {
      ...initialState(),
      assets: [newest, withReview],
    } as unknown as StudioState;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...state, assets: [newest] })),
      ),
    );

    const { result } = renderHook(() =>
      useStudioState({
        projectId: "p",
        initialState: state,
        initialSelectedAssetId: "newest",
      }),
    );

    act(() => result.current.applyAsset(asset("older")));
    await act(async () => {
      await result.current.refresh();
    });

    expect(
      result.current.state.assets.find((a) => a.id === "older")?.review,
    ).toBeNull();

    vi.unstubAllGlobals();
  });

  it("ignores an asset it has never heard of", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(initialState()))),
    );
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "p",
        initialState: initialState(),
        initialSelectedAssetId: "newest",
      }),
    );

    act(() => result.current.applyAsset(asset("from-another-project")));
    // Merging a stranger in would put a version on screen that this project's
    // own paging never returned.
    expect(result.current.state.assets).toHaveLength(2);

    vi.unstubAllGlobals();
  });
});
