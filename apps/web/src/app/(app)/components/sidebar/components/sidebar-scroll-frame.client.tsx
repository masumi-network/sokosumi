"use client";

import { type ReactNode, useEffect, useRef } from "react";

const NORMAL_LINE_HEIGHT_RATIO = 1.5;
const CHAT_VIEWPORT_SELECTOR =
  '[data-slot="sidebar-content"] [data-slot="scroll-area-viewport"]';

/** Keeps wheel scrolling useful over fixed navigation as well as the room list. */
export function SidebarScrollFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);

  // A native non-passive listener can stop the page scrolling behind the sidebar.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    function handleWheel(event: WheelEvent) {
      const target = event.target;
      const viewport = frame?.querySelector<HTMLElement>(
        CHAT_VIEWPORT_SELECTOR,
      );
      if (
        !viewport ||
        !(target instanceof Node) ||
        !frame?.contains(target) ||
        viewport.contains(target) ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        viewport.scrollHeight <= viewport.clientHeight
      ) {
        return;
      }

      const style = getComputedStyle(viewport);
      const lineHeight =
        Number.parseFloat(style.lineHeight) ||
        Number.parseFloat(style.fontSize) * NORMAL_LINE_HEIGHT_RATIO;
      const deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.clientHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? lineHeight
            : 1;

      event.preventDefault();
      viewport.scrollTop += event.deltaY * deltaUnit;
    }

    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      ref={frameRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}
