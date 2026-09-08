"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import DefaultErrorBoundary from "@/components/default-error-boundary";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";

import { ChatErrorFallback } from "./chat-error-fallback";

type SearchParamsLike = { toString(): string } | null | undefined;

/**
 * Keep message jumps within the mounted room. Consuming the message parameter
 * must not discard its thread state or the lookup still in flight.
 * Other query changes, such as Welcome notices, still reset the boundary.
 */
export function chatRouteErrorBoundaryKey(
  pathname: string,
  searchParams?: SearchParamsLike,
): string {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  params.delete(CHAT_MESSAGE_PARAM);
  const search = params.toString();
  return search.length > 0 ? `${pathname}?${search}` : pathname;
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
