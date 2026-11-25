import { render } from "@testing-library/react";
import { type RefObject, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type StudioSort,
  useStudioSortRefresh,
} from "./use-studio-sort-refresh";

function Harness({
  projectId,
  sort,
  loadedSortRef,
  refresh,
}: {
  projectId: string | null;
  sort: StudioSort;
  loadedSortRef: RefObject<StudioSort>;
  refresh: () => void | Promise<void>;
}) {
  useStudioSortRefresh(projectId, sort, loadedSortRef, refresh);
  return null;
}

describe("useStudioSortRefresh", () => {
  it("does not refresh when sort matches the loaded sort or projectId is null", () => {
    const refresh = vi.fn();
    const loadedSortRef: RefObject<StudioSort> = { current: "newest" };

    const { rerender } = render(
      <Harness
        projectId="project-1"
        sort="newest"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).not.toHaveBeenCalled();

    rerender(
      <Harness
        projectId={null}
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("loads once on initial ?sort=best under StrictMode without a second fetch", () => {
    const loadedSortRef: RefObject<StudioSort> = { current: "newest" };
    const refresh = vi.fn();

    render(
      <StrictMode>
        <Harness
          projectId="project-1"
          sort="best"
          loadedSortRef={loadedSortRef}
          refresh={refresh}
        />
      </StrictMode>,
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reloads once per sort transition on Back/Forward and uses the latest refresh callback", () => {
    const loadedSortRef: RefObject<StudioSort> = { current: "newest" };
    const firstRefresh = vi.fn(() => {
      loadedSortRef.current = "best";
    });
    const secondRefresh = vi.fn(() => {
      loadedSortRef.current = "newest";
    });
    const thirdRefresh = vi.fn(() => {
      loadedSortRef.current = "best";
    });

    const { rerender } = render(
      <Harness
        projectId="project-1"
        sort="newest"
        loadedSortRef={loadedSortRef}
        refresh={firstRefresh}
      />,
    );
    expect(firstRefresh).not.toHaveBeenCalled();

    // Forward to ?sort=best
    rerender(
      <Harness
        projectId="project-1"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={firstRefresh}
      />,
    );
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    // Unrelated refresh identity change does not trigger a second fetch
    rerender(
      <Harness
        projectId="project-1"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={secondRefresh}
      />,
    );
    expect(secondRefresh).not.toHaveBeenCalled();

    // Back to default newest
    rerender(
      <Harness
        projectId="project-1"
        sort="newest"
        loadedSortRef={loadedSortRef}
        refresh={secondRefresh}
      />,
    );
    expect(secondRefresh).toHaveBeenCalledTimes(1);

    // Forward to ?sort=best again
    rerender(
      <Harness
        projectId="project-1"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={thirdRefresh}
      />,
    );
    expect(thirdRefresh).toHaveBeenCalledTimes(1);
  });

  it("reloads when switching projects while sort stays best", () => {
    const loadedSortRef: RefObject<StudioSort> = { current: "newest" };
    const refresh = vi.fn(() => {
      loadedSortRef.current = "best";
    });

    const { rerender } = render(
      <Harness
        projectId="project-1"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    // Switching projects resets loadedSortRef to the new project's SSR default ("newest").
    loadedSortRef.current = "newest";
    rerender(
      <Harness
        projectId="project-2"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes again on newest -> best -> newest before best settles", () => {
    const loadedSortRef: RefObject<StudioSort> = { current: "newest" };
    // Never mutates loadedSortRef: simulates Best still pending or failing.
    const refresh = vi.fn();

    const { rerender } = render(
      <Harness
        projectId="project-1"
        sort="newest"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).not.toHaveBeenCalled();

    rerender(
      <Harness
        projectId="project-1"
        sort="best"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(
      <Harness
        projectId="project-1"
        sort="newest"
        loadedSortRef={loadedSortRef}
        refresh={refresh}
      />,
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
