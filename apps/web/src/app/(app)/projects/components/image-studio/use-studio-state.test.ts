import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioState } from "./types";
import { useStudioState } from "./use-studio-state";

/**
 * The rule these tests exist for: a generation finishing must not take the
 * screen away from someone who has since chosen to look at something else.
 */

// A moment ago, so a click during the test lands *after* the job started —
// which is exactly the ordering the auto-selection rule turns on.
const JOB_STARTED_AT = new Date(Date.now() - 60_000).toISOString();

function asset(id: string, version: number) {
  return {
    id,
    rootId: "root-1",
    parentId: null,
    version,
    prompt: "p",
    model: "m",
    width: 1024,
    height: 1024,
    bytes: 100,
    contentType: "image/png",
    createdAt: JOB_STARTED_AT,
    jobId: `job-${id}`,
    contentPath: `/v1/projects/project-1/image-studio/assets/${id}/content`,
    review: null,
  } as unknown as StudioState["assets"][number];
}

function job(assetId: string | null, status: string) {
  return {
    id: `job-${assetId ?? "pending"}`,
    status,
    kind: "GENERATE",
    prompt: "p",
    error: null,
    parentAssetId: null,
    assetId,
    createdAt: JOB_STARTED_AT,
    submittedAt: JOB_STARTED_AT,
    settledAt: null,
    retryMayDuplicateCharge: false,
  } as unknown as StudioState["jobs"][number];
}

const INITIAL: StudioState = {
  assets: [asset("a1", 1)],
  jobs: [job(null, "QUEUED")],
  sessions: [],
  nextCursor: null,
};

const WITH_RESULT: StudioState = {
  assets: [asset("a2", 2), asset("a1", 1)],
  jobs: [job("a2", "SUCCEEDED")],
  sessions: [],
  nextCursor: null,
};

function mockFetch(state: StudioState) {
  return vi.fn(
    async () => new Response(JSON.stringify(state), { status: 200 }),
  );
}

describe("useStudioState", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a finished generation when the person is still waiting for it", async () => {
    vi.stubGlobal("fetch", mockFetch(WITH_RESULT));
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "project-1",
        initialState: INITIAL,
        initialSelectedAssetId: null,
      }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.selectedAsset?.id).toBe("a2");
    });
  });

  it("keeps the version the person chose, even when a newer one arrives", async () => {
    vi.stubGlobal("fetch", mockFetch(WITH_RESULT));
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "project-1",
        initialState: INITIAL,
        initialSelectedAssetId: null,
      }),
    );

    // The person clicks back to v1 after the job was started.
    act(() => {
      result.current.selectAsset("a1");
    });
    expect(result.current.selectedAsset?.id).toBe("a1");

    await act(async () => {
      await result.current.refresh();
    });

    // Their choice stands. Stealing the preview here is the bug.
    expect(result.current.selectedAsset?.id).toBe("a1");
  });

  it("reports the choice upward so the URL can hold it across a reload", async () => {
    vi.stubGlobal("fetch", mockFetch(INITIAL));
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "project-1",
        initialState: INITIAL,
        initialSelectedAssetId: null,
        onSelectionChange,
      }),
    );

    act(() => {
      result.current.selectAsset("a1");
    });

    expect(onSelectionChange).toHaveBeenCalledWith("a1");
  });

  it("restores the selection named in the URL rather than the newest version", () => {
    vi.stubGlobal("fetch", mockFetch(WITH_RESULT));
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "project-1",
        initialState: WITH_RESULT,
        initialSelectedAssetId: "a1",
      }),
    );

    expect(result.current.selectedAsset?.id).toBe("a1");
  });

  it("surfaces an expired session instead of silently showing stale state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { result } = renderHook(() =>
      useStudioState({
        projectId: "project-1",
        initialState: INITIAL,
        initialSelectedAssetId: null,
      }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toContain("session expired");
  });
});
