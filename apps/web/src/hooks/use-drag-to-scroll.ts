"use client";

import { useEffect, useRef } from "react";

const DRAG_THRESHOLD_PX = 5;

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]';

function isScrollDragBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest(
      `${INTERACTIVE_SELECTOR}, [data-dnd-draggable], [data-no-drag-scroll]`,
    ),
  );
}

export function useDragToScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const pointerStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    isScrolling: boolean;
  } | null>(null);

  useEffect(() => {
    const maybeContainer = ref.current;
    if (!maybeContainer) return;

    const scrollContainer: T = maybeContainer;

    const clearScrollingStyles = () => {
      scrollContainer.removeAttribute("data-drag-scrolling");
    };

    const resetPointerState = () => {
      pointerStateRef.current = null;
      clearScrollingStyles();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.pointerType === "touch") return;
      if (isScrollDragBlocked(event.target)) return;

      pointerStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scrollContainer.scrollLeft,
        isScrolling: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const state = pointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;

      if (event.buttons === 0) {
        if (state.isScrolling) {
          scrollContainer.releasePointerCapture(event.pointerId);
        }
        resetPointerState();
        return;
      }

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;

      if (!state.isScrolling) {
        if (
          Math.abs(deltaX) < DRAG_THRESHOLD_PX &&
          Math.abs(deltaY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }

        if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          resetPointerState();
          return;
        }

        state.isScrolling = true;
        scrollContainer.setPointerCapture(event.pointerId);
        scrollContainer.setAttribute("data-drag-scrolling", "true");
      }

      event.preventDefault();
      scrollContainer.scrollLeft = state.scrollLeft - deltaX;
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const state = pointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;

      if (state.isScrolling) {
        scrollContainer.releasePointerCapture(event.pointerId);
      }

      resetPointerState();
    };

    scrollContainer.addEventListener("pointerdown", handlePointerDown);
    scrollContainer.addEventListener("pointermove", handlePointerMove);
    scrollContainer.addEventListener("pointerup", handlePointerEnd);
    scrollContainer.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("pointermove", handlePointerMove);
      scrollContainer.removeEventListener("pointerup", handlePointerEnd);
      scrollContainer.removeEventListener("pointercancel", handlePointerEnd);
      resetPointerState();
    };
  }, []);

  return ref;
}
