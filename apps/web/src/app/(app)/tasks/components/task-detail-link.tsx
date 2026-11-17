"use client";

import type { ComponentProps, MouseEvent } from "react";

import { RestingIntentLink } from "@/components/resting-intent-link";
import { storeTasksReturnPath } from "./task-navigation";

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
    />
  );
}
