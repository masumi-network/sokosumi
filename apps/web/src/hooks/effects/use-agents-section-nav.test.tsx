import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAgentsSectionNav,
  writeAgentsSectionHash,
} from "./use-agents-section-nav";

const IDS = ["bots", "coworkers", "market"] as const;

/** A scrolling `main` holding the bar and one heading per section. */
function mountPage(tops: Record<string, number>, { hidden = false } = {}) {
  const main = document.createElement("main");
  main.style.overflowY = "auto";
  const nav = document.createElement("nav");
  nav.getBoundingClientRect = () => ({ bottom: 100 }) as DOMRect;
  nav.getClientRects = () => (hidden ? [] : [{}]) as unknown as DOMRectList;
  main.append(nav);
  const headings: Record<string, HTMLElement> = {};
  for (const id of IDS) {
    const heading = document.createElement("h2");
    heading.id = id;
    heading.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
    heading.scrollIntoView = vi.fn();
    headings[id] = heading;
    main.append(heading);
  }
  Object.defineProperties(main, {
    scrollTop: { value: 10, writable: true },
    clientHeight: { value: 800 },
    scrollHeight: { value: 5000 },
  });
  document.body.append(main);
  return { main, nav, headings, tops };
}

describe("useAgentsSectionNav", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    window.history.replaceState(null, "", "/agents?query=meme");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("marks the section whose heading passed the bar", () => {
    const { nav } = mountPage({ bots: -900, coworkers: 90, market: 2000 });

    const { result } = renderHook(() => useAgentsSectionNav(nav, IDS));

    expect(result.current).toBe("coworkers");
  });

  it("names the section in the hash as the reader scrolls, keeping the search", () => {
    const page = mountPage({ bots: 0, coworkers: 900, market: 2000 });
    const { result } = renderHook(() => useAgentsSectionNav(page.nav, IDS));

    page.tops.market = 50;
    page.tops.coworkers = -1000;
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("market");
    expect(window.location.search).toBe("?query=meme");
    expect(window.location.hash).toBe("#market");

    page.tops.market = 3000;
    page.tops.coworkers = 2000;
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("bots");
    expect(window.location.hash).toBe("");
  });

  it("returns to the section the hash names, as Back from a profile does", () => {
    window.history.replaceState(null, "", "/agents?query=meme#market");
    const { nav, headings } = mountPage({
      bots: 0,
      coworkers: 900,
      market: 2000,
    });

    renderHook(() => useAgentsSectionNav(nav, IDS));

    expect(headings.market.scrollIntoView).toHaveBeenCalledWith({
      block: "start",
    });
  });

  it("leaves desktop alone while the bar is hidden", () => {
    window.history.replaceState(null, "", "/agents#market");
    const page = mountPage(
      { bots: 0, coworkers: 900, market: 50 },
      { hidden: true },
    );

    renderHook(() => useAgentsSectionNav(page.nav, IDS));
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(page.headings.market.scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#market");
  });

  it("stops listening once unmounted", () => {
    const page = mountPage({ bots: 0, coworkers: 900, market: 2000 });
    const { unmount } = renderHook(() => useAgentsSectionNav(page.nav, IDS));
    unmount();

    page.tops.market = 50;
    page.main.dispatchEvent(new Event("scroll"));

    expect(window.location.hash).toBe("");
  });
});

describe("writeAgentsSectionHash", () => {
  it("keeps the first section's URL clean", () => {
    window.history.replaceState(null, "", "/agents?query=x#market");

    writeAgentsSectionHash("bots", "bots");

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/agents?query=x",
    );
    expect(window.location.hash).toBe("");
  });
});
