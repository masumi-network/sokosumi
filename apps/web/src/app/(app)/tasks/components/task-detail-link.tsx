"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
  useEffect,
  useRef,
} from "react";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";
import { storeTasksReturnPath } from "./task-navigation";

/**
 * How long one predicted approach covers a link before the next one prefetches
 * again. Hover, focus and touch still prefetch each time.
 */
const TASK_APPROACH_REPEAT_MS = 60_000;

/**
 * How long the pointer must rest on a link before it loads the page's content.
 * A pointer that only crosses a list on its way elsewhere never starts a
 * server render.
 */
export const TASK_HOVER_DWELL_MS = 100;

interface TaskDetailLinkProps
  extends Omit<ComponentProps<typeof Link>, "href" | "ref"> {
  href: string;
}

export function TaskDetailLink({
  href,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onTouchStart,
  ...props
}: TaskDetailLinkProps) {
  const router = useRouter();

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A predicted approach and a touch load only the shared App Shell. A resting
  // hover and focus also load the page's content, a server render each.
  const prefetchTaskShell = () => {
    router.prefetch(href);
  };
  const prefetchTaskDetail = () => {
    prefetchRouteContent(router, href);
  };
  // The link's box is its text. A card stretches the link over itself with a
  // pseudo-element, which only the hover handler below can see.
  const approachRef = useIntentPrefetch<HTMLAnchorElement>(prefetchTaskShell, {
    reactivateAfter: TASK_APPROACH_REPEAT_MS,
  });

  function cancelHoverPrefetch() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }
  useEffect(() => cancelHoverPrefetch, []);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || typeof window === "undefined") {
      return;
    }

    storeTasksReturnPath();
  }

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (!event.defaultPrevented) {
      cancelHoverPrefetch();
      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null;
        prefetchTaskDetail();
      }, TASK_HOVER_DWELL_MS);
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    cancelHoverPrefetch();
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (!event.defaultPrevented) {
      prefetchTaskDetail();
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLAnchorElement>) {
    onTouchStart?.(event);
    if (!event.defaultPrevented) {
      prefetchTaskShell();
    }
  }

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
      ref={approachRef}
    />
  );
}
