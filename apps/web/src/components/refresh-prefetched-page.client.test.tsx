import { act, render } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** The module keeps when it last refreshed, so each test loads it anew. */
async function loadAt(now: number) {
  vi.setSystemTime(now);
  vi.resetModules();
  return await import("./refresh-prefetched-page.client");
}

function hydrate(ui: React.ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(ui);
  document.body.appendChild(container);
  return render(ui, { container, hydrate: true });
}

function goBack() {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// The module dates the document load from `performance.timeOrigin`.
const LOADED_AT = Math.floor(performance.timeOrigin) + 1;

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

describe("RefreshPrefetchedPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: LOADED_AT });
    refresh.mockReset();
    visit("/tasks");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A refresh drops every page prefetched for the next click, and a click
  // opens data at most the prefetch stale time old.
  it("does not refresh a page a click opened", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    vi.setSystemTime(LOADED_AT + 60_000);

    render(<RefreshPrefetchedPage />);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the copy back or forward shows", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);

    goBack();
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not take a back long ago for this visit", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    goBack();
    vi.setSystemTime(LOADED_AT + 5_000);

    render(<RefreshPrefetchedPage />);

    expect(refresh).not.toHaveBeenCalled();
  });

  // Shared layouts (session, workspace lock) are reused by every click.
  it("refreshes once the shared layouts are old, then waits again", async () => {
    const { RefreshPrefetchedPage, LAYOUT_REFRESH_MS } =
      await loadAt(LOADED_AT);
    vi.setSystemTime(LOADED_AT + LAYOUT_REFRESH_MS + 1);

    const first = render(<RefreshPrefetchedPage />);
    first.unmount();
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledOnce();
  });

  // A content prefetch of a page visited within Next's 5 minutes takes that
  // visit's copy, with no request.
  it("refreshes a return to a page whose last visit's copy is old", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    render(<RefreshPrefetchedPage />).unmount();
    visit("/projects");
    render(<RefreshPrefetchedPage />).unmount();

    vi.setSystemTime(LOADED_AT + 60_000);
    visit("/tasks");
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledOnce();
  });

  // Each return keeps the first visit's data in the browser's copy.
  it("counts from the first visit, not the latest return", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    render(<RefreshPrefetchedPage />).unmount();
    for (const [at, path] of [
      [20_000, "/projects"],
      [25_000, "/tasks"],
      [45_000, "/projects"],
    ] as const) {
      vi.setSystemTime(LOADED_AT + at);
      visit(path);
      render(<RefreshPrefetchedPage />).unmount();
    }
    expect(refresh).not.toHaveBeenCalled();

    vi.setSystemTime(LOADED_AT + 50_000);
    visit("/tasks");
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh a quick return, whose copy is still fresh", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    render(<RefreshPrefetchedPage />).unmount();
    visit("/projects");
    render(<RefreshPrefetchedPage />).unmount();

    vi.setSystemTime(LOADED_AT + 20_000);
    visit("/tasks");
    render(<RefreshPrefetchedPage />);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes one back for one visit", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);

    goBack();
    render(<RefreshPrefetchedPage />).unmount();
    visit("/projects");
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes on each visit when the page asks for it", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);

    const first = render(<RefreshPrefetchedPage everyVisit />);
    first.unmount();
    render(<RefreshPrefetchedPage everyVisit />);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a page the document load just rendered", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);

    goBack();
    hydrate(<RefreshPrefetchedPage everyVisit />);

    expect(refresh).not.toHaveBeenCalled();
  });

  // Next keeps a left page in a hidden <Activity> and shows it again with its
  // state, so the hydration flag must not outlive the first visit.
  it("refreshes when back shows a hydrated page again", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    const { rerender } = hydrate(
      <Activity mode="visible">
        <RefreshPrefetchedPage />
      </Activity>,
    );

    act(() => {
      rerender(
        <Activity mode="hidden">
          <RefreshPrefetchedPage />
        </Activity>,
      );
    });
    goBack();
    act(() => {
      rerender(
        <Activity mode="visible">
          <RefreshPrefetchedPage />
        </Activity>,
      );
    });

    expect(refresh).toHaveBeenCalledOnce();
  });
});
