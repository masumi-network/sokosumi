import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPrefetchMock = vi.fn();
const router = { prefetch: routerPrefetchMock };
let pathname = "/";
let scopedProjectId: string | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}));

vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  // Like the real hook, each render hands out a function bound to the scope
  // of that render.
  useProjectScope: () => {
    const projectId = scopedProjectId;
    return {
      hrefFor: (href: string) =>
        projectId ? `${href}?projectId=${projectId}` : href,
    };
  },
}));

import {
  ACTIVE_WINDOW_MS,
  WARM_INTERVAL_MS,
  WarmLikelyPages,
} from "./warm-likely-pages.client";

const FULL = expect.objectContaining({ kind: "full" });

function storeVisits(counts: Record<string, number>) {
  window.localStorage.setItem(
    "sokosumi:likely-pages:v1",
    JSON.stringify(counts),
  );
}

function loadedPages() {
  return routerPrefetchMock.mock.calls.map(([href]) => href);
}

describe("WarmLikelyPages", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    // happy-dom has requestIdleCallback; the timeout path is the same loop.
    vi.stubGlobal("requestIdleCallback", undefined);
    routerPrefetchMock.mockReset();
    window.localStorage.clear();
    pathname = "/";
    scopedProjectId = null;
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the most visited pages other than the one showing, once idle", () => {
    storeVisits({ "/tasks": 5, "/": 9, "/projects": 3 });
    render(<WarmLikelyPages />);
    expect(routerPrefetchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2_000));

    expect(routerPrefetchMock.mock.calls).toEqual([
      ["/tasks", FULL],
      ["/projects", FULL],
    ]);
  });

  // Next skips a page still fresh in its cache, so asking again only renders
  // a page that expired or that a refresh dropped.
  it("asks again on each interval", () => {
    storeVisits({ "/tasks": 1 });
    render(<WarmLikelyPages />);

    act(() => vi.advanceTimersByTime(2_000 + WARM_INTERVAL_MS));

    expect(loadedPages()).toEqual(["/tasks", "/tasks"]);
  });

  it("loads nothing while the tab is hidden", () => {
    storeVisits({ "/tasks": 1 });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    render(<WarmLikelyPages />);

    act(() => vi.advanceTimersByTime(2_000 + WARM_INTERVAL_MS));

    expect(routerPrefetchMock).not.toHaveBeenCalled();
    hidden.mockRestore();
  });

  it("stops once the reader leaves the tab alone, and resumes on input", () => {
    storeVisits({ "/tasks": 1 });
    render(<WarmLikelyPages />);

    act(() => vi.advanceTimersByTime(ACTIVE_WINDOW_MS + WARM_INTERVAL_MS));
    routerPrefetchMock.mockReset();
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));
    expect(routerPrefetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("keydown"));
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));
    expect(loadedPages()).toEqual(["/tasks"]);
  });

  // The sidebar links carry the project scope; a page loaded without it is
  // a different page, never opened by the click.
  it("loads the URL the sidebar link opens in the reader's project", () => {
    storeVisits({ "/tasks": 1 });
    scopedProjectId = "p-1";
    const { rerender } = render(<WarmLikelyPages />);
    act(() => vi.advanceTimersByTime(2_000));
    scopedProjectId = "p-2";
    rerender(<WarmLikelyPages />);
    act(() => vi.advanceTimersByTime(WARM_INTERVAL_MS));

    expect(loadedPages()).toEqual([
      "/tasks?projectId=p-1",
      "/tasks?projectId=p-2",
    ]);
  });

  it("counts each page the reader opens", () => {
    pathname = "/tasks";
    const { rerender } = render(<WarmLikelyPages />);
    pathname = "/projects";
    rerender(<WarmLikelyPages />);
    pathname = "/tasks";
    rerender(<WarmLikelyPages />);

    expect(
      JSON.parse(window.localStorage.getItem("sokosumi:likely-pages:v1") ?? ""),
    ).toEqual({ "/tasks": 2, "/projects": 1 });
  });
});
