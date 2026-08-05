"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./chat-error-fallback";

/**
 * Page-only error boundary keyed by pathname so a failed segment does not
 * latch across soft navigations within the chat layout (layout stays mounted).
 */
export function ChatRouteErrorBoundary({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <DefaultErrorBoundary key={pathname} fallback={<ChatErrorFallback />}>
      {children}
    </DefaultErrorBoundary>
  );
}
