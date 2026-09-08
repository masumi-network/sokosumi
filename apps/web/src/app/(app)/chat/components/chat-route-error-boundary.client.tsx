"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { pathWithoutOneShotRoomParams } from "@/app/chat/utils/chat-route-base";
import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./chat-error-fallback";

type SearchParamsLike = { toString(): string } | null | undefined;

/**
 * Keep one-shot room requests within the mounted room. Consuming the message
 * parameter must not discard its thread state or the lookup still in flight,
 * and the edit parameter has less than that to survive on: the room holds the
 * dialog it asks for in state, which a remount would throw away before the
 * reader ever saw it.
 * Other query changes, such as Welcome notices, still reset the boundary.
 */
export function chatRouteErrorBoundaryKey(
  pathname: string,
  searchParams?: SearchParamsLike,
): string {
  return pathWithoutOneShotRoomParams(pathname, searchParams);
}

/**
 * Page-only error boundary keyed by pathname + search so a failed segment
 * does not latch across soft navigations within the chat layout (layout
 * stays mounted).
 */
export function ChatRouteErrorBoundary({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <DefaultErrorBoundary
      key={chatRouteErrorBoundaryKey(pathname, searchParams)}
      fallback={<ChatErrorFallback />}
    >
      {children}
    </DefaultErrorBoundary>
  );
}
