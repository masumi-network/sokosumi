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

import {
  isTasksRootPath,
  TASKS_RETURN_PATH_SESSION_KEY,
} from "./task-navigation";

interface TaskDetailLinkProps
  extends Omit<ComponentProps<typeof Link>, "href"> {
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

  const prefetchTaskDetail = () => {
    router.prefetch(href);
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || typeof window === "undefined") {
          return;
        }

        if (isTasksRootPath(window.location.pathname)) {
          window.sessionStorage.setItem(
            TASKS_RETURN_PATH_SESSION_KEY,
            `${window.location.pathname}${window.location.search}`,
          );
        }
      }}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) {
          prefetchTaskDetail();
        }
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (!event.defaultPrevented) {
          prefetchTaskDetail();
        }
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) {
          prefetchTaskDetail();
        }
      }}
    />
  );
}
