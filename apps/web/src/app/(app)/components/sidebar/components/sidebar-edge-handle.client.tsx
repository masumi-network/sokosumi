"use client";

import { useTranslations } from "next-intl";
import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";

import { useChatTabUnreadPresence } from "@/app/chat/components/use-chat-tab-unread-presence";
import { useSidebar } from "@/components/ui/sidebar";
import { SIDEBAR_HIDE_TRANSITION } from "@/components/ui/sidebar-classes";
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
/** What the button's description points at while the dot is showing. */
const UNREAD_DOT_ID = "sidebar-edge-unread";
/** Arrow keys resize by this much. */
const KEY_STEP_PX = 16;

interface Drag {
  startX: number;
  moved: boolean;
  /** The width in force when the press began: what a collapse leaves behind. */
  committed: number;
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

function commitWidth(px: number) {
  applyWidth(px);
  document.cookie = serializeSidebarWidthCookie(px);
}

/**
 * The sidebar's edge as a control: drag it to resize, drag it past the
 * collapse line to hide the sidebar, click it (or press Enter) to hide or show
 * it. Hidden, it becomes a strip on the window's left edge that opens the
 * sidebar the same ways, and carries the unread-chats dot the sidebar's rows
 * can no longer show. ⌘B / Ctrl+B still toggles, through `SidebarProvider`.
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
  // The click that ends a drag must not also toggle.
  const swallowClick = useRef(false);

  if (isMobile) {
    return null;
  }

  const wrapper = () =>
    ref.current?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      startX: event.clientX,
      moved: false,
      committed: readWidth(),
      opened: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
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

    const collapsing = event.clientX < SIDEBAR_COLLAPSE_AT;
    if (collapsing) {
      ref.current?.setAttribute("data-collapsing", "true");
    } else {
      ref.current?.removeAttribute("data-collapsing");
      if (!open && !current.opened) {
        current.opened = true;
        setOpen(true);
      }
    }
    // Below the line the width stays at the minimum: what the reader sees is
    // that the sidebar cannot get narrower, and releasing collapses it.
    applyWidth(clampSidebarWidth(event.clientX));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current.moved) return;

    swallowClick.current = true;
    ref.current?.removeAttribute("data-dragging");
    ref.current?.removeAttribute("data-collapsing");
    const collapse = cancelled
      ? !open && !current.opened
      : event.clientX < SIDEBAR_COLLAPSE_AT;

    if (collapse) {
      // The width it reopens at is the one it had before this drag.
      applyWidth(current.committed);
      wrapper()?.removeAttribute("data-resizing");
      if (open || current.opened) setOpen(false);
      return;
    }

    commitWidth(clampSidebarWidth(event.clientX));
    wrapper()?.removeAttribute("data-resizing");
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
      aria-keyshortcuts="Meta+B Control+B"
      aria-describedby={open ? undefined : UNREAD_DOT_ID}
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
        "hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring data-[dragging=true]:after:bg-sidebar-ring data-[collapsing=true]:after:bg-primary",
      )}
    >
      {open ? null : <HiddenUnreadDot />}
    </button>
  );
}

/**
 * Hiding the sidebar must never hide a message, so while it is hidden the
 * strip carries the Chats unread signal as a dot, described to assistive
 * technology as "Unread chats" through the button. It sits below the top bar,
 * which covers the strip's head. Mounted only while hidden, so the presence
 * reader runs only while the room list is out of sight.
 */
function HiddenUnreadDot() {
  const t = useTranslations("App.Sidebar");
  const { showUnreadDot } = useChatTabUnreadPresence();

  if (!showUnreadDot) return null;

  return (
    <span
      data-slot="sidebar-edge-unread-dot"
      className="bg-primary absolute top-20 left-0 size-1.5 rounded-full"
    >
      <span id={UNREAD_DOT_ID} className="sr-only">
        {t("unreadChats")}
      </span>
    </span>
  );
}
