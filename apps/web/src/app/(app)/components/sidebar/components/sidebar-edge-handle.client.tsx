"use client";

import { useTranslations } from "next-intl";
import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_HIDE_TRANSITION } from "@/components/ui/sidebar-classes";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  clampSidebarWidth,
  parseSidebarWidthCookieHeader,
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_DEFAULT_WIDTH,
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
  moved: boolean;
  /** A drag that began collapsed opens the sidebar once it passes the line. */
  opened: boolean;
  /** The sidebar snapped shut under this drag: the rest of it does nothing. */
  snapped: boolean;
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
 * A click (or Enter) hides or shows it. Hidden, the edge is a strip on the
 * window's left that can be dragged back out; the header's toggle is the
 * visible control then, so the strip leaves the tab order and the
 * accessibility tree. ⌘B / Ctrl+B toggles through `SidebarProvider`.
 *
 * Must follow the sidebar as its sibling: it reads the sidebar's `data-state`
 * through `peer-*`, so the boot script's pre-paint collapse moves it too.
 * The width is written straight to the document while dragging, so a move
 * never re-renders the sidebar.
 */
export function SidebarEdgeHandle() {
  const t = useTranslations("App.Sidebar");
  const { open, setOpen, toggleSidebar, isMobile } = useSidebar();
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click that ends a drag must not also toggle.
  const swallowClick = useRef(false);

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

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // A press that lands mid-slide takes the stored width, not the narrowed
    // one the timer was about to replace.
    if (restoreTimer.current) restoreNow();
    // A press that ended without a click (a cancel) must not eat this one.
    swallowClick.current = false;
    drag.current = {
      startX: event.clientX,
      moved: false,
      opened: false,
      snapped: false,
    };
  }

  function snapShut(current: Drag) {
    current.snapped = true;
    ref.current?.removeAttribute("data-dragging");
    // Easing back on, so the panel slides out instead of vanishing.
    wrapper()?.removeAttribute("data-resizing");
    setOpen(false);
    restoreAfterSlideOut();
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.snapped) return;
    if (
      !current.moved &&
      Math.abs(event.clientX - current.startX) < DRAG_START_PX
    ) {
      return;
    }
    if (!current.moved) {
      current.moved = true;
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

  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current.moved) return;

    // A cancel is not followed by a click.
    swallowClick.current = !cancelled;
    ref.current?.removeAttribute("data-dragging");
    wrapper()?.removeAttribute("data-resizing");
    if (current.snapped) return;

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
      commitWidth(clampSidebarWidth(event.clientX));
    }
  }

  function onClick() {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    toggleSidebar();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) return;
    const step =
      event.key === "ArrowLeft"
        ? -KEY_STEP_PX
        : event.key === "ArrowRight"
          ? KEY_STEP_PX
          : 0;
    if (step === 0) return;
    event.preventDefault();
    commitWidth(clampSidebarWidth(readWidth() + step));
  }

  return (
    <button
      ref={ref}
      type="button"
      data-slot="sidebar-edge-handle"
      aria-label={open ? t("hide") : t("show")}
      aria-expanded={open}
      aria-hidden={open ? undefined : true}
      aria-keyshortcuts="Meta+B Control+B"
      tabIndex={open ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        // Straddles the sidebar's border, 3px each side; hidden, the strip
        // hugs the window's edge. Follows the panel as it slides.
        "group/edge fixed inset-y-0 z-20 hidden w-1.5 cursor-col-resize touch-none outline-hidden md:block",
        "left-[calc(var(--sidebar-width)-3px)] peer-data-[state=collapsed]:left-0 peer-data-[state=collapsed]:w-2",
        `transition-[left] ${SIDEBAR_HIDE_TRANSITION} group-data-[resizing=true]/sidebar-wrapper:transition-none`,
        // The line: a 2px rule on the edge, shown on hover, focus and drag.
        "after:absolute after:inset-y-0 after:left-0.5 after:w-0.5 after:bg-transparent peer-data-[state=collapsed]:after:left-0",
        "hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring data-[dragging=true]:after:bg-sidebar-ring",
      )}
    />
  );
}
