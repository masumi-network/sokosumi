"use client";

import { useEffect, useState } from "react";

import { useIsMobile } from "./use-mobile";

/** Marks a section still streaming in; its stable wrapper already carries the id. */
const LOADING_SELECTOR = "[data-agents-section-loading]";

/** How long a return keeps re-placing its section while sections stream in. */
const RESTORE_MS = 10_000;

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
 * reader is in: the last whose top passed the bar, or the last one once
 * the page is scrolled to the end.
 *
 * On a return to the page (Back from a profile, a reload, a shared link),
 * scrolls to the section the hash names, and keeps it in place while the
 * sections above it stream in, until they all have or the reader scrolls.
 *
 * Runs below `md` only, and follows the breakpoint: from `md` the bar is
 * hidden and desktop keeps its plain scrolling.
 */
export function useAgentsSectionNav(
  nav: HTMLElement | null,
  ids: readonly string[],
): string | undefined {
  const isMobile = useIsMobile();
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  const key = ids.join(" ");

  useEffect(() => {
    if (!nav || !isMobile) return;
    const bar = nav;
    const sectionIds = key.split(" ");
    const scroller = scrollParent(bar);
    // The opaque bar covers the scroller's top: focus scrolling and jumps
    // must keep targets below it (WCAG 2.4.11), so pad the scrollport.
    const paddingBefore = scroller.style.scrollPaddingTop;
    scroller.style.scrollPaddingTop = `${Math.round(
      bar.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top,
    )}px`;

    function read(): string | undefined {
      const present = sectionIds.filter((id) => document.getElementById(id));
      if (
        scroller.scrollTop > 0 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      ) {
        return present.at(-1);
      }
      const line = bar.getBoundingClientRect().bottom + 16;
      let found = present[0];
      for (const id of present) {
        const heading = document.getElementById(id);
        if (heading && heading.getBoundingClientRect().top <= line) found = id;
      }
      return found;
    }

    const hashTarget = window.location.hash.slice(1);
    let restoring: string | null = sectionIds.includes(hashTarget)
      ? hashTarget
      : null;
    const observer = new MutationObserver(place);
    const deadline = window.setTimeout(stopRestoring, RESTORE_MS);

    function stopRestoring() {
      restoring = null;
      observer.disconnect();
      window.clearTimeout(deadline);
    }

    // Scrolls to the hash's section; done once nothing above it still loads.
    function place() {
      if (!restoring) return;
      const heading = document.getElementById(restoring);
      if (heading) heading.scrollIntoView({ block: "start" });
      if (heading && !scroller.querySelector(LOADING_SELECTOR)) stopRestoring();
    }

    if (restoring) {
      observer.observe(scroller, { childList: true, subtree: true });
      place();
    } else {
      stopRestoring();
    }
    setCurrent(read());

    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = read();
        if (!next) return;
        setCurrent(next);
        // A return still placing its section owns the hash until done.
        if (!restoring) writeAgentsSectionHash(next, sectionIds[0]);
      });
    }
    // The reader taking over (touch, wheel, keys) ends a return's placing.
    const listening = new AbortController();
    const options = { passive: true, signal: listening.signal };
    scroller.addEventListener("scroll", onScroll, options);
    scroller.addEventListener("pointerdown", stopRestoring, options);
    scroller.addEventListener("wheel", stopRestoring, options);
    scroller.addEventListener("touchstart", stopRestoring, options);
    scroller.addEventListener("keydown", stopRestoring, options);
    return () => {
      scroller.style.scrollPaddingTop = paddingBefore;
      listening.abort();
      observer.disconnect();
      window.clearTimeout(deadline);
      cancelAnimationFrame(frame);
    };
  }, [nav, key, isMobile]);

  return current;
}
