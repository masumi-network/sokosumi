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
    const element = ref.current;
    if (!element) return;

    function clearScrollingStyles() {
      element.removeAttribute("data-drag-scrolling");
    }

    function resetPointerState() {
      pointerStateRef.current = null;
      clearScrollingStyles();
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (event.pointerType === "touch") return;
      if (isScrollDragBlocked(event.target)) return;

      pointerStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: element.scrollLeft,
        isScrolling: false,
      };
    }

    function handlePointerMove(event: PointerEvent) {
      const state = pointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;

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
        element.setPointerCapture(event.pointerId);
        element.setAttribute("data-drag-scrolling", "true");
      }

      event.preventDefault();
      element.scrollLeft = state.scrollLeft - deltaX;
    }

    function handlePointerEnd(event: PointerEvent) {
      const state = pointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;

      if (state.isScrolling) {
        element.releasePointerCapture(event.pointerId);
      }

      resetPointerState();
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerEnd);
    element.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerEnd);
      element.removeEventListener("pointercancel", handlePointerEnd);
      resetPointerState();
    };
  }, []);

  return ref;
}
