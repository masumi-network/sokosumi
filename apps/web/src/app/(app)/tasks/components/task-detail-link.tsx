"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ComponentProps,
  FocusEvent,
  MouseEvent,
  PointerEvent,
  TouchEvent,
} from "react";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { prefetchRouteContent } from "@/lib/navigation/prefetch-route-content";
import { storeTasksReturnPath } from "./task-navigation";

/**
 * How long one predicted approach covers a link before the next one prefetches
 * again. Hover, focus and touch still prefetch each time.
 */
const TASK_APPROACH_REPEAT_MS = 60_000;

interface TaskDetailLinkProps
  extends Omit<ComponentProps<typeof Link>, "href" | "ref"> {
  href: string;
}

export function TaskDetailLink({
  href,
  onClick,
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: TaskDetailLinkProps) {
  const router = useRouter();

  // A predicted approach loads only the shared App Shell. Hover, focus and
  // touch also load the page's content, which costs a server render each.
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
      prefetchTaskDetail();
    }
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
      prefetchTaskDetail();
    }
  }

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
      ref={approachRef}
    />
  );
}
