import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAgentsSectionNav,
  writeAgentsSectionHash,
} from "./use-agents-section-nav";

const IDS = ["bots", "coworkers", "market"] as const;

/** `matchMedia` with a phone/desktop switch, as Tailwind's `md` sees it. */
function stubViewport(initial: "phone" | "desktop") {
  let phone = initial === "phone";
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("min-width") ? phone : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return (next: "phone" | "desktop") => {
    phone = next === "phone";
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function heading(id: string, tops: Record<string, number>) {
  const element = document.createElement("h2");
  element.id = id;
  element.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
  element.scrollIntoView = vi.fn();
  return element;
}

/**
 * A scrolling `main` holding the bar and one heading per section. A section
 * in `loading` is still a Suspense fallback; one in `missing` has no heading.
 */
function mountPage(
  tops: Record<string, number>,
  {
    loading = [],
    missing = [],
  }: { loading?: string[]; missing?: string[] } = {},
) {
  const main = document.createElement("main");
  main.style.overflowY = "auto";
  const nav = document.createElement("nav");
  nav.getBoundingClientRect = () => ({ bottom: 100 }) as DOMRect;
  main.append(nav);
  const headings: Record<string, HTMLElement> = {};
  for (const id of IDS) {
    const section = document.createElement("section");
    if (loading.includes(id)) {
      section.setAttribute("data-agents-section-loading", "");
    }
    if (!missing.includes(id)) {
      headings[id] = heading(id, tops);
      section.append(headings[id]);
    }
    main.append(section);
  }
  Object.defineProperties(main, {
    scrollTop: { value: 10, writable: true },
    clientHeight: { value: 800 },
    scrollHeight: { value: 5000 },
  });
  document.body.append(main);
  return { main, nav, headings, tops };
}

/** Lets the hook's `MutationObserver` see a DOM change. */
async function flushMutations() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAgentsSectionNav", () => {
  let setViewport: ReturnType<typeof stubViewport>;

  beforeEach(() => {
    setViewport = stubViewport("phone");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    window.history.replaceState(null, "", "/agents?query=meme");
  });

  afterEach(() => {
    document.body.innerHTML = "";
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

  it("waits for a section that is still streaming in, then jumps to it", async () => {
    window.history.replaceState(null, "", "/agents?query=meme#market");
    const page = mountPage(
      { bots: 0, coworkers: 900, market: 2000 },
      { missing: ["market"], loading: ["market"] },
    );
    renderHook(() => useAgentsSectionNav(page.nav, IDS));

    const market = heading("market", page.tops);
    const section = page.main.querySelectorAll("section")[2];
    section.removeAttribute("data-agents-section-loading");
    section.append(market);
    await flushMutations();

    expect(market.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(window.location.hash).toBe("#market");
  });

  it("keeps the section in place while sections above it stream in", async () => {
    window.history.replaceState(null, "", "/agents#market");
    const page = mountPage(
      { bots: 0, coworkers: 900, market: 2000 },
      { loading: ["bots"] },
    );
    renderHook(() => useAgentsSectionNav(page.nav, IDS));
    expect(page.headings.market.scrollIntoView).toHaveBeenCalledTimes(1);

    // The Soko Bots fallback resolves: the page grows above Marketplace.
    page.main
      .querySelector("[data-agents-section-loading]")
      ?.removeAttribute("data-agents-section-loading");
    page.main.querySelector("section")?.append(document.createElement("ul"));
    await flushMutations();
    expect(page.headings.market.scrollIntoView).toHaveBeenCalledTimes(2);

    // Done once nothing loads: later changes leave the reader alone.
    page.main.append(document.createElement("div"));
    await flushMutations();
    expect(page.headings.market.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("stops placing the section once the reader scrolls themselves", async () => {
    window.history.replaceState(null, "", "/agents#market");
    const page = mountPage(
      { bots: 0, coworkers: 900, market: 2000 },
      { loading: ["bots"] },
    );
    renderHook(() => useAgentsSectionNav(page.nav, IDS));

    act(() => {
      page.main.dispatchEvent(new Event("touchstart"));
    });
    page.main.querySelector("section")?.append(document.createElement("ul"));
    await flushMutations();

    expect(page.headings.market.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("leaves desktop alone", () => {
    setViewport("desktop");
    window.history.replaceState(null, "", "/agents#market");
    const page = mountPage({ bots: 0, coworkers: 900, market: 50 });

    renderHook(() => useAgentsSectionNav(page.nav, IDS));
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(page.headings.market.scrollIntoView).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#market");
  });

  it("starts following the scroll when the window narrows to a phone", () => {
    setViewport("desktop");
    const page = mountPage({ bots: 0, coworkers: 900, market: 2000 });
    const { result } = renderHook(() => useAgentsSectionNav(page.nav, IDS));

    setViewport("phone");
    page.tops.market = 50;
    page.tops.coworkers = -1000;
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("market");
    expect(window.location.hash).toBe("#market");
  });

  it("stops writing the hash when the window widens to desktop", () => {
    const page = mountPage({ bots: 0, coworkers: 900, market: 2000 });
    renderHook(() => useAgentsSectionNav(page.nav, IDS));

    setViewport("desktop");
    page.tops.market = 50;
    page.tops.coworkers = -1000;
    act(() => {
      page.main.dispatchEvent(new Event("scroll"));
    });

    expect(window.location.hash).toBe("");
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
