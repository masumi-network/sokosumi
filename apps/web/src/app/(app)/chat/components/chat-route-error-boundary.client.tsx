"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./chat-error-fallback";

type SearchParamsLike = { toString(): string } | null | undefined;

/**
 * Remount key for the page error boundary. Pathname alone is not enough:
 * `/`, `/?create=channel`, and `/?dm=new` share a pathname but
 * are distinct soft-navigations within the welcome layout.
 */
export function chatRouteErrorBoundaryKey(
  pathname: string,
  searchParams?: SearchParamsLike,
): string {
  const search = searchParams?.toString() ?? "";
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
