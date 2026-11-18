"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
  type RefObject,
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  msUntilIntentSettled,
  useIntentPrefetch,
} from "@/hooks/use-intent-prefetch";
import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";

/**
 * How long the pointer must rest on a link before it loads the page's content.
 * Short, as it only covers a link the predicted approach missed. The hover
 * itself starts no server render for a pointer that crosses the link faster;
 * the cursor's path may still have loaded it.
 */
export const HOVER_DWELL_MS = 20;

/**
 * How long keyboard focus must rest on a link before it loads the page's
 * content, so holding Tab through a list does not render every page it passes.
 */
export const FOCUS_DWELL_MS = 100;

/**
 * How long one predicted approach covers a link before the next one prefetches
 * again. Hover, focus and touch still prefetch each time.
 */
const APPROACH_REPEAT_MS = 60_000;

/** Marks the card a link covers, so the card is what the cursor heads for. */
export const INTENT_AREA_ATTRIBUTE = "data-intent-area";
const INTENT_AREA_SELECTOR = `[${INTENT_AREA_ATTRIBUTE}]`;

type DwellTimer = ReturnType<typeof setTimeout> | null;

/**
 * A plain primary press opens the link in this tab. A middle click, a
 * modified click or a context menu leaves the pointer resting on it.
 */
function opensInThisTab(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

interface RestingIntentLinkProps
  extends Omit<ComponentProps<typeof Link>, "href"> {
  href: string;
  /**
   * True only for a route whose page reads are private-cached. Otherwise the
   * prefetch is a full server render that still carries only the loading
   * skeleton.
   */
  prefetchContent?: boolean;
}

/** Sets a ref the caller passed, and returns how to clear it. */
function attachRef<T>(ref: Ref<T> | undefined, value: T): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (ref) {
    ref.current = value;
    return () => {
      ref.current = null;
    };
  }
  return () => {};
}

/**
 * A link that loads its page's content when the cursor's path heads for it,
 * or once a mouse or pen hover, or keyboard focus, rests on it. A touch loads
 * only the shared App Shell.
 */
export function RestingIntentLink({
  href,
  ref,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onTouchStart,
  prefetchContent = false,
  ...props
}: RestingIntentLinkProps) {
  const router = useRouter();

  // Hover and focus dwell apart, so leaving one never cancels the other.
  const hoverTimer = useRef<DwellTimer>(null);
  const focusTimer = useRef<DwellTimer>(null);
  // While a free hover or keyboard focus rests on the link, its content loads
  // again when a refresh drops it, so the click still opens a loaded page.
  const hovering = useRef(false);
  const keyboardFocused = useRef(false);
  // A reload asks for the page the link leads to now, and only while it
  // still loads content: a new href or the current page starts over.
  const loads = useRef({ href, prefetchContent });
  useEffect(() => {
    loads.current = { href, prefetchContent };
  });
  const keepLoadedFor = (loadedHref: string) => () =>
    (hovering.current || keyboardFocused.current) &&
    loads.current.prefetchContent &&
    loads.current.href === loadedHref;
  // A touch loads only the shared App Shell. A resting hover and focus also
  // load the page's content, a server render each.
  const prefetchShell = () => {
    router.prefetch(href);
  };
  const prefetchContentOrShell = () => {
    if (prefetchContent) {
      prefetchRouteContent(router, href, { keepLoaded: keepLoadedFor(href) });
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
  useEffect(
    () => () => {
      cancelAllDwells();
      hovering.current = false;
      keyboardFocused.current = false;
    },
    [],
  );

  function startDwell(timer: RefObject<DwellTimer>, dwellMs: number) {
    cancelDwell(timer);
    timer.current = setTimeout(() => {
      timer.current = null;
      prefetchContentOrShell();
    }, dwellMs);
  }

  // A scroll moves rows under a still cursor, and each leaves before the
  // scroll stops. The hover dwell starts once the scroll has stopped, so only
  // the row the reader stops on loads.
  function startHoverDwell() {
    cancelDwell(hoverTimer);
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      if (msUntilIntentSettled() > 0) {
        startHoverDwell();
      } else {
        prefetchContentOrShell();
      }
    }, msUntilIntentSettled() + HOVER_DWELL_MS);
  }

  // The cursor's path predicts the click before the pointer arrives, so the
  // content is usually loaded by the time the hover starts. A Tab stop close
  // by, or a touch that may only start a scroll, loads only the App Shell:
  // focus and a resting hover still load the content. The link's box is its
  // text: a card that stretches the link over itself with a pseudo-element
  // still relies on the hover handler, unless the card marks itself as the
  // link's area. Such a card is not a Tab stop, so its link gets no App Shell
  // load from a Tab stop close by: focus still loads the content.
  const approachRef = useIntentPrefetch<HTMLElement>(
    (source) => {
      if (source === "pointer") {
        prefetchContentOrShell();
      } else {
        prefetchShell();
      }
    },
    { reactivateAfter: APPROACH_REPEAT_MS },
  );
  // A caller's ref must be stable: a new one each render registers the link
  // with the library again, which resets its once-a-minute hold.
  const linkRef = useCallback(
    (element: HTMLAnchorElement | null) => {
      if (!element) return;
      // A card that marks itself as the link's area is the target the
      // cursor's path is measured against, so the whole card predicts.
      const stopApproach = approachRef(
        element.closest<HTMLElement>(INTENT_AREA_SELECTOR) ?? element,
      );
      const detachRef = attachRef(ref, element);
      return () => {
        stopApproach?.();
        detachRef();
      };
    },
    [approachRef, ref],
  );

  // The click or tap loads the page itself. A later dwell or reload would
  // render it again.
  function stopResting() {
    cancelAllDwells();
    hovering.current = false;
    keyboardFocused.current = false;
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (opensInThisTab(event)) {
      stopResting();
    } else {
      cancelAllDwells();
    }
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
      hovering.current = true;
      startHoverDwell();
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    hovering.current = false;
    cancelDwell(hoverTimer);
  }

  // A press starts a click, middle click or tap, which loads the page itself.
  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    onPointerDown?.(event);
    if (opensInThisTab(event)) {
      stopResting();
    } else {
      cancelAllDwells();
    }
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
      keyboardFocused.current = true;
      startDwell(focusTimer, FOCUS_DWELL_MS);
    }
  }

  function handleBlur(event: FocusEvent<HTMLAnchorElement>) {
    onBlur?.(event);
    keyboardFocused.current = false;
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
      ref={linkRef}
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
