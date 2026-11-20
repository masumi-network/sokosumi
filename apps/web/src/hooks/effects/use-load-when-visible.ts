import { type RefObject, useEffect, useRef } from "react";

interface UseLoadWhenVisibleOptions {
  /** Watch only while this holds; a boundary that is loading or has failed does not. */
  armed: boolean;
  /**
   * Where the boundary sits. A new value re-arms the watch, so a boundary that
   * moved asks again even when it never left the screen.
   */
  boundaryKey: string;
  onVisible: () => void;
  /**
   * CSS margin around the list's scroller, as `rootMargin`. The element counts
   * as visible this far before it is on screen, so the next page is there
   * when the reader arrives.
   */
  ahead?: string;
}

function scrollerOf(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Calls `onVisible` once when the element scrolls into view, for a list
 * boundary that loads the next page on its own: reading toward the end of a
 * list fills it without hunting for a button.
 *
 * Fires at most once per arming. The caller disarms it while the load runs
 * and re-arms it when the load settles, which is what keeps one boundary from
 * asking twice for the same page.
 */
export function useLoadWhenVisible(
  ref: RefObject<Element | null>,
  { armed, boundaryKey, onVisible, ahead }: UseLoadWhenVisibleOptions,
): void {
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  // Syncs with the viewport, which is an external system: the element cannot
  // know it has scrolled into view any other way. `boundaryKey` is read by
  // nothing inside; it is a dependency so that a moved boundary re-arms.
  useEffect(() => {
    const element = ref.current;
    if (!armed || !element || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        onVisibleRef.current();
      },
      // A margin only reaches past the scroller when the scroller is the root.
      ahead ? { root: scrollerOf(element), rootMargin: ahead } : undefined,
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, armed, boundaryKey, ahead]);
}
