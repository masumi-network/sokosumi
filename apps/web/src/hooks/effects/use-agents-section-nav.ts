"use client";

import { useEffect, useState } from "react";

/** The nearest ancestor that scrolls: the app's `main` on phones. */
function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * Names the section in the URL's hash, so Back from a profile returns to it.
 * The first section is the page's top and needs no hash. `replaceState`
 * keeps one history entry per page; Next.js keeps its own state on it.
 */
export function writeAgentsSectionHash(id: string, first: string): void {
  const hash = id === first ? "" : `#${id}`;
  if (window.location.hash === hash) return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}${hash}`);
}

/**
 * The phone-only section bar on the Agents page. Returns the section the
 * reader is in: the last whose heading passed the bar, or the last one once
 * the page is scrolled to the end. On a return to the page (Back from a
 * profile shows it again), scrolls back to the section the hash names.
 * Does nothing while the bar is hidden (from `md`), so desktop keeps its
 * plain scrolling.
 */
export function useAgentsSectionNav(
  nav: HTMLElement | null,
  ids: readonly string[],
): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  const key = ids.join(" ");

  useEffect(() => {
    if (!nav || nav.getClientRects().length === 0) return;
    const sectionIds = key.split(" ");
    const scroller = scrollParent(nav);

    function read(): string | undefined {
      const present = sectionIds.filter((id) => document.getElementById(id));
      if (
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      ) {
        return present.at(-1);
      }
      // nav is non-null: the effect returned early otherwise.
      const line = (nav as HTMLElement).getBoundingClientRect().bottom + 16;
      let found = present[0];
      for (const id of present) {
        const heading = document.getElementById(id);
        if (heading && heading.getBoundingClientRect().top <= line) found = id;
      }
      return found;
    }

    const target = window.location.hash.slice(1);
    if (sectionIds.includes(target)) {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }
    setCurrent(read());

    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = read();
        if (!next) return;
        setCurrent(next);
        writeAgentsSectionHash(next, sectionIds[0]);
      });
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [nav, key]);

  return current;
}
