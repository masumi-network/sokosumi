"use client";

import { useTranslations } from "next-intl";
import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_HIDE_TRANSITION } from "@/components/ui/sidebar-classes";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  clampSidebarWidth,
  parseSidebarWidthCookieHeader,
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_USER_WIDTH_VAR,
  serializeSidebarWidthCookie,
} from "@/lib/ui-preferences/sidebar-state";
import { cn } from "@/lib/utils";

/** A press that moves less than this is a click, not a drag. */
const DRAG_START_PX = 4;
/** Arrow keys resize by this much. */
const KEY_STEP_PX = 16;
/**
 * How long the sidebar takes to slide out (`SIDEBAR_HIDE_TRANSITION`), plus a
 * frame: the width it reopens at is put back only after it is out of sight.
 */
const SLIDE_OUT_MS = 250;

interface Drag {
  startX: number;
  /**
   * `pressed` until the pointer travels `DRAG_START_PX`, then `dragging`; a
   * snap-shut ends it as `snapped`, and the rest of the drag does nothing.
   */
  phase: "pressed" | "dragging" | "snapped";
  /** A drag that began collapsed opens the sidebar once it passes the line. */
  opened: boolean;
}

function readWidth() {
  return (
    parseSidebarWidthCookieHeader(document.cookie) ?? SIDEBAR_DEFAULT_WIDTH
  );
}

function applyWidth(px: number) {
  document.documentElement.style.setProperty(SIDEBAR_USER_WIDTH_VAR, `${px}px`);
}

/** Puts back the stored width, or the default when none was ever stored. */
function applyStoredWidth() {
  const stored = parseSidebarWidthCookieHeader(document.cookie);
  if (stored === null) {
    document.documentElement.style.removeProperty(SIDEBAR_USER_WIDTH_VAR);
  } else {
    applyWidth(stored);
  }
}

function commitWidth(px: number) {
  applyWidth(px);
  document.cookie = serializeSidebarWidthCookie(px);
}

/**
 * The sidebar's edge as a control: drag it to resize; drag it past the
 * collapse line and the sidebar snaps shut, sliding out the way ⌘B hides it.
 * A click hides or shows it. Shown, it is a window splitter for assistive
 * technology (`role="separator"`, value in px): arrows resize, Enter hides.
 * Hidden, the edge is a strip on the window's left that can be dragged back
 * out; the header's toggle is the visible control then, so the strip leaves
 * the tab order and the accessibility tree. ⌘B / Ctrl+B toggles through
 * `SidebarProvider`.
 *
 * Must follow the sidebar as its sibling: it reads the sidebar's `data-state`
 * through `peer-*`, so the boot script's pre-paint collapse moves it too.
 * The width is written straight to the document while dragging, so a move
 * never re-renders the sidebar.
 */
export function SidebarEdgeHandle() {
  const t = useTranslations("App.Sidebar");
  const { open, setOpen, toggleSidebar, isMobile } = useSidebar();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click that ends a drag must not also toggle.
  const swallowClick = useRef(false);
  // What the splitter reports; the width itself lives on `<html>` while
  // dragging, so a move never re-renders.
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);

  const wrapper = () =>
    ref.current?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');

  /** Ends the wait for the slide-out and puts the stored width back now. */
  function restoreNow() {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = null;
    applyStoredWidth();
  }

  /** The narrowed width is for show: restore once the panel is out of sight. */
  function restoreAfterSlideOut() {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(restoreNow, SLIDE_OUT_MS);
  }

  // Reopening inside the slide-out window (⌘B, the header toggle) must start
  // from the stored width, not wait for the timer.
  useEffect(() => {
    if (open && restoreTimer.current) restoreNow();
  }, [open]);

  // Leaving mid-drag or mid-slide must not strand `data-resizing` on the
  // wrapper or a timer that writes to a document nobody is dragging.
  useMountEffect(() => {
    // The stored width, for the splitter's value: the cookie is not there on
    // the server.
    setWidth(readWidth());
    const node = ref.current;
    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      node
        ?.closest('[data-slot="sidebar-wrapper"]')
        ?.removeAttribute("data-resizing");
    };
  });

  if (isMobile) {
    return null;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // A press that lands mid-slide takes the stored width, not the narrowed
    // one the timer was about to replace.
    if (restoreTimer.current) restoreNow();
    // A press that ended without a click (a cancel) must not eat this one.
    swallowClick.current = false;
    drag.current = {
      startX: event.clientX,
      phase: "pressed",
      opened: false,
    };
  }

  function snapShut(current: Drag) {
    current.phase = "snapped";
    ref.current?.removeAttribute("data-dragging");
    // Easing back on, so the panel slides out instead of vanishing.
    wrapper()?.removeAttribute("data-resizing");
    setOpen(false);
    restoreAfterSlideOut();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.phase === "snapped") return;
    if (
      current.phase === "pressed" &&
      Math.abs(event.clientX - current.startX) < DRAG_START_PX
    ) {
      return;
    }
    if (current.phase === "pressed") {
      current.phase = "dragging";
      wrapper()?.setAttribute("data-resizing", "true");
      ref.current?.setAttribute("data-dragging", "true");
    }

    if (event.clientX < SIDEBAR_COLLAPSE_AT) {
      // A drag that began collapsed and never passed the line has nothing to
      // hide: it stays shut.
      if (open || current.opened) snapShut(current);
      return;
    }

    if (!open && !current.opened) {
      current.opened = true;
      setOpen(true);
    }
    applyWidth(clampSidebarWidth(event.clientX));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.phase === "pressed") return;

    // A cancel is not followed by a click.
    swallowClick.current = !cancelled;
    ref.current?.removeAttribute("data-dragging");
    wrapper()?.removeAttribute("data-resizing");
    if (current.phase === "snapped") return;

    if (cancelled) {
      if (current.opened) {
        // It opened under this drag: put it back as it was, sliding out.
        setOpen(false);
        restoreAfterSlideOut();
      } else {
        applyStoredWidth();
      }
      return;
    }
    if (open || current.opened) {
      const next = clampSidebarWidth(event.clientX);
      commitWidth(next);
      setWidth(next);
    }
  }

  function onClick() {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    toggleSidebar();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Enter") {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    const step =
      event.key === "ArrowLeft"
        ? -KEY_STEP_PX
        : event.key === "ArrowRight"
          ? KEY_STEP_PX
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = clampSidebarWidth(readWidth() + step);
    commitWidth(next);
    setWidth(next);
  }

  return (
    <div
      ref={ref}
      data-slot="sidebar-edge-handle"
      // Shown: the window splitter pattern. Hidden: the header toggle is the
      // control, and the strip is only a drag target.
      {...(open
        ? {
            role: "separator",
            "aria-orientation": "vertical",
            "aria-label": t("resize"),
            "aria-valuenow": width,
            "aria-valuemin": SIDEBAR_MIN_WIDTH,
            "aria-valuemax": SIDEBAR_MAX_WIDTH,
            "aria-keyshortcuts": "Meta+B Control+B",
            tabIndex: 0,
          }
        : { "aria-hidden": true })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        // Straddles the sidebar's border, 3px each side; hidden, the strip
        // hugs the window's edge. Follows the panel as it slides.
        "group/edge fixed inset-y-0 z-20 hidden w-1.5 cursor-col-resize touch-none outline-none md:block",
        "left-[calc(var(--sidebar-width)-3px)] peer-data-[state=collapsed]:left-0 peer-data-[state=collapsed]:w-2",
        `transition-[left] ${SIDEBAR_HIDE_TRANSITION} group-data-[resizing=true]/sidebar-wrapper:transition-none`,
        // A 6px strip is too thin to hit: its target reaches 8px into each
        // side, 22px in all, over the sidebar's and the page's own edges.
        "before:absolute before:inset-y-0 before:-right-2 before:-left-2",
        // The line: a 2px rule on the edge, shown on hover, focus and drag.
        "after:absolute after:inset-y-0 after:left-0.5 after:w-0.5 after:bg-transparent peer-data-[state=collapsed]:after:left-0",
        "hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring data-[dragging=true]:after:bg-sidebar-ring",
        // Keyboard focus rings the whole strip, not only the line.
        "focus-visible:outline-2 focus-visible:outline-sidebar-ring",
      )}
    />
  );
}
