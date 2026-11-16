"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type TouchEvent,
  useEffect,
  useRef,
} from "react";

import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";

/**
 * How long the pointer must rest on a link before it loads the page's content.
 * A pointer that only crosses a list on its way elsewhere never starts a
 * server render.
 */
export const INTENT_DWELL_MS = 100;

type DwellTimer = ReturnType<typeof setTimeout> | null;

interface RestingIntentLinkProps
  extends Omit<ComponentProps<typeof Link>, "href"> {
  href: string;
  /**
   * False for a route whose page reads are not cached: its prefetch would be
   * a full server render that still carries only the loading skeleton.
   */
  prefetchContent?: boolean;
}

/**
 * A link that loads its page's content once a mouse or pen hover, or keyboard
 * focus, rests on it. A touch loads only the shared App Shell.
 */
export function RestingIntentLink({
  href,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onTouchStart,
  prefetchContent = true,
  ...props
}: RestingIntentLinkProps) {
  const router = useRouter();

  // Hover and focus dwell apart, so leaving one never cancels the other.
  const hoverTimer = useRef<DwellTimer>(null);
  const focusTimer = useRef<DwellTimer>(null);
  // A touch loads only the shared App Shell. A resting hover and focus also
  // load the page's content, a server render each.
  const prefetchShell = () => {
    router.prefetch(href);
  };
  const prefetchContentOrShell = () => {
    if (prefetchContent) {
      prefetchRouteContent(router, href);
    } else {
      prefetchShell();
    }
  };

  function cancelDwell(timer: RefObject<DwellTimer>) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function cancelAllDwells() {
    cancelDwell(hoverTimer);
    cancelDwell(focusTimer);
  }
  useEffect(() => cancelAllDwells, []);

  function startDwell(timer: RefObject<DwellTimer>) {
    cancelDwell(timer);
    timer.current = setTimeout(() => {
      timer.current = null;
      prefetchContentOrShell();
    }, INTENT_DWELL_MS);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // The click already loads the page; a later dwell would render it twice.
    cancelAllDwells();
    onClick?.(event);
  }

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    // A finger also enters every row it rests on while it scrolls, and a drag
    // or text selection crosses rows with a button held, so only a free mouse
    // or pen hover loads the content.
    if (
      !event.defaultPrevented &&
      event.pointerType !== "touch" &&
      event.buttons === 0
    ) {
      startDwell(hoverTimer);
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    cancelDwell(hoverTimer);
  }

  // A press starts a click, middle click or tap, which loads the page itself.
  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    onPointerDown?.(event);
    cancelAllDwells();
  }

  // Browsers also focus a link on a click or tap. Only keyboard focus, which
  // matches :focus-visible, is reading intent, and it rests like a hover so
  // tabbing through a list does not render every page it passes.
  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (
      !event.defaultPrevented &&
      event.currentTarget.matches(":focus-visible")
    ) {
      startDwell(focusTimer);
    }
  }

  function handleBlur(event: FocusEvent<HTMLAnchorElement>) {
    onBlur?.(event);
    cancelDwell(focusTimer);
  }

  function handleTouchStart(event: TouchEvent<HTMLAnchorElement>) {
    onTouchStart?.(event);
    if (!event.defaultPrevented) {
      prefetchShell();
    }
  }

  return (
    <Link
      {...props}
      href={href}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTouchStart={handleTouchStart}
    />
  );
}
