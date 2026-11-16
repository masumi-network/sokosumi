"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { RestingIntentLink } from "@/components/resting-intent-link";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { storeTasksReturnPath } from "./task-navigation";

/**
 * How long one predicted approach covers a link before the next one prefetches
 * again. Hover, focus and touch still prefetch each time.
 */
const TASK_APPROACH_REPEAT_MS = 60_000;

type TaskDetailLinkProps = Omit<
  ComponentProps<typeof RestingIntentLink>,
  "ref" | "prefetch"
>;

export function TaskDetailLink({
  href,
  onClick,
  prefetchContent = true,
  ...props
}: TaskDetailLinkProps) {
  const router = useRouter();

  // A predicted approach is weaker intent than a resting hover, so it loads
  // only the shared App Shell.
  // The link's box is its text. A card stretches the link over itself with a
  // pseudo-element, which only the hover handler can see.
  const approachRef = useIntentPrefetch<HTMLAnchorElement>(
    () => router.prefetch(href),
    { reactivateAfter: TASK_APPROACH_REPEAT_MS },
  );

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || typeof window === "undefined") {
      return;
    }

    storeTasksReturnPath();
  }

  return (
    <RestingIntentLink
      {...props}
      prefetchContent={prefetchContent}
      href={href}
      prefetch={false}
      onClick={handleClick}
      ref={approachRef}
    />
  );
}
