"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MAX_FIXED_HEIGHT_RATIO = 0.55;
const NORMAL_LINE_HEIGHT_RATIO = 1.5;
const CHAT_VIEWPORT_SELECTOR =
  '[data-slot="sidebar-content"] [data-slot="scroll-area-viewport"]';

/** Keeps wheel scrolling useful over fixed navigation as well as the room list. */
export function SidebarScrollFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fixedNavigation, setFixedNavigation] = useState(false);

  // A native non-passive listener can stop the page scrolling behind the sidebar.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const chrome = Array.from(frame.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.dataset.slot !== "sidebar-content",
    );
    let canFixNavigation = false;
    function measure() {
      if (!frame) return;
      const fixedHeight = chrome.reduce(
        (height, child) => height + child.offsetHeight,
        0,
      );
      canFixNavigation =
        frame.clientHeight > 0 &&
        fixedHeight <= frame.clientHeight * MAX_FIXED_HEIGHT_RATIO;
      setFixedNavigation(canFixNavigation);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    for (const child of chrome) observer.observe(child, { box: "border-box" });
    measure();

    function handleWheel(event: WheelEvent) {
      const target = event.target;
      const viewport = frame?.querySelector<HTMLElement>(
        CHAT_VIEWPORT_SELECTOR,
      );
      if (
        !canFixNavigation ||
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
    return () => {
      observer.disconnect();
      frame.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      data-fixed-navigation={fixedNavigation}
      className={cn(
        "flex min-h-0 flex-1 flex-col *:data-[slot=sidebar-header]:shrink-0",
        fixedNavigation
          ? "overflow-hidden"
          : "app-scrollbar overflow-y-auto overscroll-contain [&>[data-slot=sidebar-content]]:flex-none [&>[data-slot=sidebar-content]]:overflow-visible [&>[data-slot=sidebar-content]>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=sidebar-content]>[data-slot=scroll-area-viewport]]:overflow-visible! [&>[data-slot=sidebar-content]>[data-slot=scroll-area-scrollbar]]:hidden",
      )}
    >
      {children}
    </div>
  );
}
