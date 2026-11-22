"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Attaches a non-passive desktop horizontal wheel listener to `AgentCarousel`
 * and batches horizontal wheel deltas into `requestAnimationFrame` scroll
 * updates, cancelling any pending frame on cleanup.
 */
export function useAgentCarouselHorizontalWheel(
  carouselRef: RefObject<HTMLDivElement | null>,
  api: object | undefined,
): void {
  const rafIdRef = useRef<number | null>(null);
  const scrollDeltaRef = useRef<number>(0);

  useEffect(() => {
    const carouselElement = carouselRef.current;
    if (!carouselElement || !api) {
      return;
    }

    const applyScroll = () => {
      const contentWrapper = carouselElement.querySelector(
        '[data-slot="carousel-content"]',
      ) as HTMLElement | null;

      if (!contentWrapper) {
        rafIdRef.current = null;
        return;
      }

      const scrollIncrement = scrollDeltaRef.current;
      const currentScrollLeft = contentWrapper.scrollLeft || 0;
      const newScrollLeft = currentScrollLeft + scrollIncrement;

      // Apply scroll incrementally
      contentWrapper.scrollLeft = newScrollLeft;

      // Also try scrolling the parent if contentWrapper doesn't work
      // Some Embla setups use the parent element
      if (contentWrapper.scrollLeft === currentScrollLeft) {
        const parent = contentWrapper.parentElement;
        if (parent) {
          parent.scrollLeft = (parent.scrollLeft || 0) + scrollIncrement;
        }
      }

      // Reset accumulated delta and clear animation frame reference
      scrollDeltaRef.current = 0;
      rafIdRef.current = null;
    };

    const handleWheel = (event: WheelEvent) => {
      // Only handle wheel events on desktop (md and above)
      const MD_BREAKPOINT = 768;
      if (window.innerWidth < MD_BREAKPOINT) {
        return;
      }

      const absDeltaX = Math.abs(event.deltaX);
      const absDeltaY = Math.abs(event.deltaY);

      // Only handle if horizontal scroll is significant and greater than vertical
      if (absDeltaX > absDeltaY) {
        event.preventDefault();

        // Accumulate scroll delta
        scrollDeltaRef.current += event.deltaX;

        // Request animation frame if one isn't already pending
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(applyScroll);
        }
      }
      // Otherwise, let the event pass through for normal page scrolling
    };

    carouselElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      carouselElement.removeEventListener("wheel", handleWheel);
      // Cancel pending animation frame on cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      scrollDeltaRef.current = 0;
    };
  }, [api]);
}
