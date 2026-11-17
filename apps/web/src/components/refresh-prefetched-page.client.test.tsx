import { act, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const routerRefresh = vi.fn();
/** What the action answers: true once the page rendered again. */
let actionAnswer: () => Promise<boolean>;
vi.mock("@/lib/actions/refresh-page-action", () => ({
  refreshPage: () => {
    refresh();
    return actionAnswer();
  },
}));
const router = { refresh: routerRefresh };
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

/** Keyboard focus on a link: the reader may press Enter on it any moment. */
function focusLink(href: string, props: React.ComponentProps<"a"> = {}) {
  render(
    <a href={href} {...props}>
      Next page
    </a>,
  );
  const link = screen.getByRole("link", { name: "Next page" });
  act(() => link.focus());
  return link;
}

describe("RefreshPrefetchedPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: LOADED_AT });
    refresh.mockReset();
    routerRefresh.mockReset();
    actionAnswer = async () => true;
    visit("/tasks");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Each refresh is one more server render, and a click opens data at most
  // the prefetch stale time old.
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
    await act(async () => {});
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

  // The refresh keeps the pages loaded for the next click, and one of them
  // may hold the copy of an earlier visit.
  it("refreshes a return to a page visited before another page refreshed", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    render(<RefreshPrefetchedPage />).unmount();
    vi.setSystemTime(LOADED_AT + 10_000);
    visit("/projects");
    goBack();
    render(<RefreshPrefetchedPage />).unmount();
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => {});

    vi.setSystemTime(LOADED_AT + 40_000);
    visit("/tasks");
    render(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  describe("while the reader is about to open another page", () => {
    // A click during the refresh makes Next discard it and then drop every
    // page loaded for the next click.
    it("waits until the link loses focus", async () => {
      const { RefreshPrefetchedPage, CONTROL_IN_USE_CHECK_MS } =
        await loadAt(LOADED_AT);
      const link = focusLink("/projects");

      goBack();
      render(<RefreshPrefetchedPage />);
      vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS);
      expect(refresh).not.toHaveBeenCalled();

      act(() => link.blur());
      vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("does not wait for a link to the page that shows", async () => {
      const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
      focusLink("/tasks#comments");

      goBack();
      render(<RefreshPrefetchedPage />);

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("waits for a link to the same page with another query", async () => {
      const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
      focusLink("/tasks?view=board");

      goBack();
      render(<RefreshPrefetchedPage />);

      expect(refresh).not.toHaveBeenCalled();
    });

    // These open outside this tab's router and cannot discard the refresh.
    it.each([
      ["another site", "https://example.com/projects", {}],
      ["a new tab", "/projects", { target: "_blank" }],
      ["a download", "/files/report.csv", { download: true }],
    ] as const)("does not wait for a link to %s", async (_, href, props) => {
      const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
      focusLink(href, props);

      goBack();
      render(<RefreshPrefetchedPage />);

      expect(refresh).toHaveBeenCalledOnce();
    });

    // Next runs one Server Action at a time: the button's would wait.
    it("waits while a button has keyboard focus", async () => {
      const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
      render(<button type="button">Mark done</button>);
      act(() => screen.getByRole("button", { name: "Mark done" }).focus());

      goBack();
      render(<RefreshPrefetchedPage />);

      expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes once the longest wait has passed", async () => {
      const {
        RefreshPrefetchedPage,
        CONTROL_IN_USE_CHECK_MS,
        MAX_REFRESH_WAIT_MS,
      } = await loadAt(LOADED_AT);
      focusLink("/projects");

      goBack();
      render(<RefreshPrefetchedPage />);
      vi.advanceTimersByTime(MAX_REFRESH_WAIT_MS - CONTROL_IN_USE_CHECK_MS);
      expect(refresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(CONTROL_IN_USE_CHECK_MS);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("drops the waiting refresh once Next hides the page", async () => {
      const { RefreshPrefetchedPage, MAX_REFRESH_WAIT_MS } =
        await loadAt(LOADED_AT);
      focusLink("/projects");
      goBack();
      const { rerender } = render(
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
      vi.advanceTimersByTime(MAX_REFRESH_WAIT_MS);

      expect(refresh).not.toHaveBeenCalled();
    });

    it("drops the waiting refresh once the page is left", async () => {
      const { RefreshPrefetchedPage, MAX_REFRESH_WAIT_MS } =
        await loadAt(LOADED_AT);
      focusLink("/projects");

      goBack();
      render(<RefreshPrefetchedPage />).unmount();
      vi.advanceTimersByTime(MAX_REFRESH_WAIT_MS);

      expect(refresh).not.toHaveBeenCalled();
    });
  });

  // A deploy replaces the action, and the old tab still calls it.
  it("refreshes in the client when the action fails", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    actionAnswer = async () => {
      throw new Error("Server Action was not found");
    };

    goBack();
    render(<RefreshPrefetchedPage />);
    await act(async () => {});

    expect(routerRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the loaded pages when the action succeeds", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);

    goBack();
    render(<RefreshPrefetchedPage />);
    await act(async () => {});

    expect(refresh).toHaveBeenCalledOnce();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  // The proxy would send the action to /signin; a client refresh follows the
  // redirect instead.
  it("refreshes in the client when the reader has no session", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    actionAnswer = async () => false;

    goBack();
    render(<RefreshPrefetchedPage />);
    await act(async () => {});

    expect(routerRefresh).toHaveBeenCalledOnce();
  });

  // The second back discarded the running refresh, and Next refreshes the
  // page that shows after it.
  it("does not start a second refresh while one runs", async () => {
    const { RefreshPrefetchedPage } = await loadAt(LOADED_AT);
    let finish = (_refreshed: boolean) => {};
    actionAnswer = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    goBack();
    render(<RefreshPrefetchedPage />).unmount();

    visit("/projects");
    goBack();
    render(<RefreshPrefetchedPage />).unmount();
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => finish(true));
    visit("/tasks");
    goBack();
    render(<RefreshPrefetchedPage />);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
